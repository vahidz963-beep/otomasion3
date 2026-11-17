<?php
/**
 * Plugin Name: Aryaman Calculator Connector
 * Description: اتصال امن مرکز محاسبه آریامن به WordPress/WooCommerce؛ قیمت‌گذاری فقط از Supabase Edge Function و با امضای HMAC انجام می‌شود.
 * Version: 1.7.0
 * Author: Aryaman
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * Text Domain: aryaman-calculator
 */

defined('ABSPATH') || exit;

final class Aryaman_Calculator_Connector {
    const VERSION = '1.7.0';
    const OPTION = 'aryaman_calculator_connector';
    const REST_NS = 'aryaman-calculator/v1';
    const QUOTE_META = '_aryaman_quote_id';

    public static function boot(): void {
        $self = new self();
        add_action('admin_menu', [$self, 'admin_menu']);
        add_action('admin_init', [$self, 'register_settings']);
        add_action('rest_api_init', [$self, 'register_routes']);
        add_shortcode('aryaman_calculator', [$self, 'shortcode']);
        add_shortcode('aryaman_board_calculator', [$self, 'board_shortcode']);
        add_action('wp_enqueue_scripts', [$self, 'register_assets']);
        add_action('woocommerce_before_calculate_totals', [$self, 'apply_cart_prices'], 20);
        add_filter('woocommerce_update_cart_validation', [$self, 'lock_quote_quantity'], 10, 4);
        add_action('woocommerce_checkout_create_order_line_item', [$self, 'copy_line_meta'], 10, 4);
        add_action('woocommerce_checkout_create_order', [$self, 'copy_order_meta'], 10, 2);
        add_action('woocommerce_payment_complete', fn($order_id) => $self->send_order_event($order_id, 'payment_confirmed'));
        add_action('woocommerce_order_status_processing', fn($order_id) => $self->send_order_event($order_id, 'order_approved'));
        foreach (['cancelled', 'refunded', 'failed'] as $status) {
            add_action("woocommerce_order_status_{$status}", fn($order_id) => $self->send_order_event($order_id, 'order_cancelled'));
        }
    }

    private function options(): array {
        return wp_parse_args((array) get_option(self::OPTION, []), [
            'endpoint_url' => '',
            'shared_secret' => '',
            'woocommerce_product_id' => 0,
        ]);
    }

    public function register_settings(): void {
        register_setting('aryaman_calculator_group', self::OPTION, [
            'type' => 'array',
            'sanitize_callback' => [$this, 'sanitize_settings'],
            'default' => [],
        ]);
    }

    public function sanitize_settings($input): array {
        $old = $this->options();
        $secret = isset($input['shared_secret']) ? trim((string) $input['shared_secret']) : '';
        if ($secret === '') $secret = (string) $old['shared_secret'];
        return [
            'endpoint_url' => esc_url_raw(rtrim((string) ($input['endpoint_url'] ?? ''), '/')),
            'shared_secret' => sanitize_text_field($secret),
            'woocommerce_product_id' => absint($input['woocommerce_product_id'] ?? 0),
        ];
    }

    public function admin_menu(): void {
        add_options_page('اتصال مرکز محاسبه آریامن', 'مرکز محاسبه آریامن', 'manage_options', 'aryaman-calculator', [$this, 'settings_page']);
    }

    public function settings_page(): void {
        if (!current_user_can('manage_options')) return;
        $options = $this->options();
        ?>
        <div class="wrap" dir="rtl">
            <h1>اتصال مرکز محاسبه آریامن</h1>
            <p>کلید Service Role هرگز در WordPress ثبت نمی‌شود. این افزونه فقط با راز مشترک HMAC به Edge Function متصل است.</p>
            <form method="post" action="options.php">
                <?php settings_fields('aryaman_calculator_group'); ?>
                <table class="form-table" role="presentation">
                    <tr><th><label for="ary-endpoint">نشانی Edge Function</label></th><td><input id="ary-endpoint" class="regular-text ltr" type="url" required name="<?php echo esc_attr(self::OPTION); ?>[endpoint_url]" value="<?php echo esc_attr($options['endpoint_url']); ?>"><p class="description">نمونه: https://PROJECT.supabase.co/functions/v1/calculator-api</p></td></tr>
                    <tr><th><label for="ary-secret">راز مشترک HMAC</label></th><td><input id="ary-secret" class="regular-text ltr" type="password" autocomplete="new-password" name="<?php echo esc_attr(self::OPTION); ?>[shared_secret]" value="" placeholder="برای حفظ مقدار فعلی خالی بگذارید"><p class="description">حداقل ۳۲ نویسه؛ همان مقدار باید در Secret با نام WORDPRESS_SHARED_SECRET ثبت شود.</p></td></tr>
                    <tr><th><label for="ary-product">شناسه محصول WooCommerce</label></th><td><input id="ary-product" type="number" min="0" name="<?php echo esc_attr(self::OPTION); ?>[woocommerce_product_id]" value="<?php echo esc_attr($options['woocommerce_product_id']); ?>"><p class="description">یک محصول ساده/مجازی برای افزودن محاسبه به سبد. قیمت توسط Snapshot امن جایگزین می‌شود.</p>
<?php if (!class_exists('WooCommerce')): ?>
<p class="description" style="color:#a5453f;font-weight:700">⚠ WooCommerce فعال نیست — دکمه «افزودن به سبد و پرداخت» نمایش داده نمی‌شود. اول WooCommerce را نصب/فعال کنید.</p>
<?php else:
    $ary_currency = strtoupper((string) get_woocommerce_currency());
    $ary_ok = in_array($ary_currency, ['IRR', 'IRT', 'TMN', 'TOMAN'], true);
    $ary_pid = absint($options['woocommerce_product_id']);
    $ary_prod_ok = $ary_pid && wc_get_product($ary_pid);
?>
<p class="description" style="color:<?php echo $ary_ok ? '#17633f' : '#a5453f'; ?>;font-weight:700">ارز فروشگاه: <?php echo esc_html($ary_currency); ?> — <?php echo $ary_ok ? 'مناسب ✓' : 'غیرمجاز ✗ (فقط ریال یا تومان)'; ?></p>
<p class="description" style="color:<?php echo $ary_prod_ok ? '#17633f' : '#a5453f'; ?>;font-weight:700"><?php echo $ary_prod_ok ? 'محصول اتصال: معتبر ✓' : 'شناسه محصول را وارد کنید (و محصول باید موجود باشد).'; ?></p>
<?php endif; ?></td></tr>
                </table>
                <?php submit_button('ذخیره اتصال'); ?>
            </form>
            <hr><p><strong>وضعیت انتشار:</strong> حتی پس از تنظیم افزونه، API عمومی در نسخهٔ ۱۳۱ به‌صورت پیش‌فرض خاموش است و فقط مدیر اتوماسیون پس از تأیید کالیبراسیون می‌تواند آن را فعال کند.</p>
            <p><strong>Shortcode:</strong> <code>[aryaman_calculator]</code></p>
        </div>
        <?php
    }

    public function register_assets(): void {
        $base = plugin_dir_url(__FILE__);
        wp_register_style('aryaman-calculator', $base . 'assets/calculator.css', [], self::VERSION);
        wp_register_script('aryaman-report', $base . 'assets/aryaman-report.js', [], self::VERSION, true);
        wp_register_script('aryaman-calculator', $base . 'assets/calculator.js', ['aryaman-report'], self::VERSION, true);
    }

    private function enqueue_config(): void {
        wp_localize_script('aryaman-calculator', 'AryamanCalculatorConfig', [
            'catalogUrl' => esc_url_raw(rest_url(self::REST_NS . '/catalog')),
            'quoteUrl' => esc_url_raw(rest_url(self::REST_NS . '/quote')),
            'confirmUrl' => esc_url_raw(rest_url(self::REST_NS . '/confirm')),
            'cartUrl' => esc_url_raw(rest_url(self::REST_NS . '/cart')),
            'boardQuoteUrl' => esc_url_raw(rest_url(self::REST_NS . '/board-quote')),
            'boardConfirmUrl' => esc_url_raw(rest_url(self::REST_NS . '/board-confirm')),
            'nonce' => wp_create_nonce('wp_rest'),
            'woocommerce' => class_exists('WooCommerce'),
            'cartPageUrl' => (class_exists('WooCommerce') && function_exists('wc_get_cart_url')) ? wc_get_cart_url() : '',
            'cartCount' => (class_exists('WooCommerce') && function_exists('WC') && WC()->cart) ? (int) WC()->cart->get_cart_contents_count() : 0,
            'pluginUrl' => plugin_dir_url(__FILE__),
        ]);
    }

    public function shortcode(): string {
        wp_enqueue_style('aryaman-calculator');
        wp_enqueue_script('aryaman-calculator');
        $this->enqueue_config();
        return '<div class="aryaman-calculator" data-aryaman-calculator><div class="aryaman-calculator__loading">در حال دریافت مدل‌های قابل محاسبه…</div></div>';
    }

    public function board_shortcode(): string {
        wp_enqueue_style('aryaman-calculator');
        wp_enqueue_script('aryaman-calculator');
        $this->enqueue_config();
        return '<div class="aryaman-calculator aryaman-board" data-aryaman-board><div class="aryaman-calculator__loading">در حال آماده‌سازی محاسبه‌گر برد…</div></div>';
    }

    public function register_routes(): void {
        register_rest_route(self::REST_NS, '/catalog', [
            'methods' => WP_REST_Server::READABLE,
            'permission_callback' => '__return_true',
            'callback' => fn() => $this->proxy(['action' => 'public_catalog'], 'catalog'),
        ]);
        register_rest_route(self::REST_NS, '/quote', [
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => '__return_true',
            'args' => ['payload' => ['required' => true, 'type' => 'object']],
            'callback' => [$this, 'quote_route'],
        ]);
        register_rest_route(self::REST_NS, '/confirm', [
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => '__return_true',
            'args' => ['payload' => ['required' => true, 'type' => 'object']],
            'callback' => [$this, 'confirm_route'],
        ]);
        register_rest_route(self::REST_NS, '/board-quote', [
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => '__return_true',
            'args' => ['payload' => ['required' => true, 'type' => 'object']],
            'callback' => [$this, 'board_quote_route'],
        ]);
        register_rest_route(self::REST_NS, '/board-confirm', [
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => '__return_true',
            'args' => ['payload' => ['required' => true, 'type' => 'object']],
            'callback' => [$this, 'board_confirm_route'],
        ]);
        register_rest_route(self::REST_NS, '/cart', [
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => function (WP_REST_Request $request): bool {
                return wp_verify_nonce((string) $request->get_header('x_wp_nonce'), 'wp_rest') !== false;
            },
            'callback' => [$this, 'cart_route'],
        ]);
    }

    public function board_quote_route(WP_REST_Request $request) {
        $payload = $this->sanitize_board_payload((array) $request->get_param('payload'));
        return $this->proxy(['action' => 'public_board_preview', 'payload' => $payload], 'board-preview-' . wp_generate_uuid4());
    }

    public function board_confirm_route(WP_REST_Request $request) {
        $payload = $this->sanitize_board_payload((array) $request->get_param('payload'));
        $response = $this->proxy(['action' => 'public_board_confirm', 'payload' => $payload], 'board-confirm-' . wp_generate_uuid4());
        if (is_wp_error($response)) return $response;
        $data = $response->get_data();
        if (!empty($data['valid']) && !empty($data['quote_id']) && !empty($data['result']['sale']['total_sale_rial'])) {
            set_transient('aryaman_quote_' . sanitize_key($data['quote_id']), [
                'calculator_type' => 'transformer',
                'quote_id' => sanitize_text_field($data['quote_id']),
                'quote_code' => sanitize_text_field($data['quote_code']),
                'quantity' => max(1, absint($data['result']['sale']['quantity'] ?? 1)),
                'result' => ['total_sale_rial' => (float) $data['result']['sale']['total_sale_rial']],
                'calculator_type' => 'board',
            ], HOUR_IN_SECONDS);
        }
        return $response;
    }

    /* Board payload whitelist — keep in sync with the plugin JS fields. */
    private function sanitize_board_payload(array $payload): array {
        $features = [];
        foreach ((array) ($payload['features'] ?? []) as $feature) {
            $feature = sanitize_key((string) $feature);
            if (in_array($feature, ['isolation', 'pfc', 'digital', 'communication', 'protection', 'emi', 'thermal'], true)) $features[] = $feature;
        }
        return [
            'width_mm' => (float) ($payload['width_mm'] ?? 0),
            'height_mm' => (float) ($payload['height_mm'] ?? 0),
            'power_w' => (float) ($payload['power_w'] ?? 0),
            'layers' => (int) ($payload['layers'] ?? 2),
            'complexity' => in_array((string) ($payload['complexity'] ?? ''), ['basic', 'medium', 'advanced'], true) ? (string) $payload['complexity'] : 'medium',
            'features' => $features,
            'quantity' => (int) ($payload['quantity'] ?? 1),
            'customer_name' => sanitize_text_field((string) ($payload['customer_name'] ?? '')),
            'customer_phone' => sanitize_text_field((string) ($payload['customer_phone'] ?? '')),
            'customer_email' => sanitize_email((string) ($payload['customer_email'] ?? '')),
            'project_title' => sanitize_text_field((string) ($payload['project_title'] ?? '')),
        ];
    }

    public function quote_route(WP_REST_Request $request) {
        $payload = $this->sanitize_quote_payload((array) $request->get_param('payload'));
        return $this->proxy(['action' => 'public_quote_preview', 'payload' => $payload], 'quote-preview-' . wp_generate_uuid4());
    }

    public function confirm_route(WP_REST_Request $request) {
        $payload = $this->sanitize_quote_payload((array) $request->get_param('payload'));
        $response = $this->proxy(['action' => 'public_quote_confirm', 'payload' => $payload], 'quote-confirm-' . wp_generate_uuid4());
        if (is_wp_error($response)) return $response;
        $data = $response->get_data();
        if (!empty($data['valid']) && !empty($data['quote_id'])) {
            set_transient('aryaman_quote_' . sanitize_key($data['quote_id']), [
                'calculator_type' => 'transformer',
                'quote_id' => sanitize_text_field($data['quote_id']),
                'quote_code' => sanitize_text_field($data['quote_code'] ?? ''),
                'result' => (array) ($data['result'] ?? []),
                'quantity' => absint($payload['quantity']),
            ], HOUR_IN_SECONDS);
        }
        return $response;
    }

    private function sanitize_quote_payload(array $raw): array {
        $order_type = ($raw['order_type'] ?? '') === 'production' ? 'production' : 'sample';
        $quantity = max(1, absint($raw['quantity'] ?? 1));
        if ($order_type === 'production') $quantity = max(100, $quantity);
        else $quantity = min(99, $quantity);
        $windings = [];
        foreach (array_slice((array) ($raw['windings'] ?? []), 0, 12) as $index => $row) {
            $row = (array) $row;
            $windings[] = [
                'name' => sanitize_text_field($row['name'] ?? ('سیم‌پیچ ' . ($index + 1))),
                'start_pin' => absint($row['start_pin'] ?? 0),
                'end_pin' => absint($row['end_pin'] ?? 0),
                'turns' => absint($row['turns'] ?? 0),
                'wire_id' => sanitize_text_field($row['wire_id'] ?? ''),
                'strands' => max(1, min(20, absint($row['strands'] ?? 1))),
                'arrangement' => ($row['arrangement'] ?? '') === 'bundle' ? 'bundle' : 'side',
                'layer_mode' => ($row['layer_mode'] ?? '') === 'manual' ? 'manual' : 'auto',
                'requested_layers' => max(1, absint($row['requested_layers'] ?? 1)),
                'insulation_wraps' => max(0, min(20, absint($row['insulation_wraps'] ?? 3))),
                'direction' => ($row['direction'] ?? '') === 'ccw' ? 'ccw' : 'cw',
            ];
        }
        return [
            'core_id' => sanitize_text_field($raw['core_id'] ?? ''),
            'bobbin_id' => sanitize_text_field($raw['bobbin_id'] ?? ''),
            'order_type' => $order_type,
            'quantity' => $quantity,
            'customer_name' => sanitize_text_field($raw['customer_name'] ?? ''),
            'customer_phone' => sanitize_text_field($raw['customer_phone'] ?? ''),
            'customer_email' => sanitize_email($raw['customer_email'] ?? ''),
            'project_title' => sanitize_text_field($raw['project_title'] ?? ''),
            'has_gap' => !empty($raw['has_gap']),
            'windings' => $windings,
        ];
    }

    public function cart_route(WP_REST_Request $request) {
        if (!class_exists('WooCommerce') || !function_exists('WC')) return new WP_Error('woocommerce_missing', 'WooCommerce فعال نیست.', ['status' => 503]);
        $quote_id = sanitize_text_field((string) $request->get_param('quote_id'));
        $cached = get_transient('aryaman_quote_' . sanitize_key($quote_id));
        if (!$cached || empty($cached['result']['total_sale_rial'])) return new WP_Error('quote_expired', 'Snapshot قیمت یافت نشد یا منقضی شده است.', ['status' => 410]);
        $options = $this->options();
        $product_id = absint($options['woocommerce_product_id']);
        if (!$product_id || !wc_get_product($product_id)) return new WP_Error('product_missing', 'محصول اتصال محاسبه‌گر در تنظیمات مشخص نشده است.', ['status' => 503]);
        $quantity = max(1, absint($cached['quantity']));
        $total_rial = (float) $cached['result']['total_sale_rial'];
        $currency = strtoupper((string) get_woocommerce_currency());
        if ($currency === 'IRR') $store_total = $total_rial;
        elseif (in_array($currency, ['IRT', 'TMN', 'TOMAN'], true)) $store_total = $total_rial / 10;
        else return new WP_Error('currency_unsupported', 'ارز فروشگاه باید ریال یا تومان باشد.', ['status' => 503]);
        $effective_unit = $store_total / $quantity;
        $cart_key = WC()->cart->add_to_cart($product_id, $quantity, 0, [], [
            'aryaman_quote_id' => $cached['quote_id'],
            'aryaman_quote_code' => $cached['quote_code'],
            'aryaman_effective_unit_price' => $effective_unit,
            'aryaman_snapshot_total_rial' => $total_rial,
            'aryaman_quote_quantity' => $quantity,
            'unique_key' => md5($cached['quote_id'] . microtime(true)),
        ]);
        if (!$cart_key) return new WP_Error('cart_failed', 'افزودن سفارش محاسبه‌شده به سبد ناموفق بود.', ['status' => 500]);
        return rest_ensure_response(['ok' => true, 'cart_url' => wc_get_cart_url()]);
    }

    public function lock_quote_quantity($passed, $cart_item_key, $values, $quantity): bool {
        if (!empty($values['aryaman_quote_id']) && absint($quantity) !== absint($values['aryaman_quote_quantity'] ?? 0)) {
            wc_add_notice('تعداد سفارش محاسبه‌شده ثابت است؛ برای تعداد جدید دوباره محاسبه کنید.', 'error');
            return false;
        }
        return (bool) $passed;
    }

    public function apply_cart_prices($cart): void {
        if (is_admin() && !wp_doing_ajax()) return;
        foreach ($cart->get_cart() as $item) {
            if (isset($item['aryaman_effective_unit_price'], $item['data'])) $item['data']->set_price((float) $item['aryaman_effective_unit_price']);
        }
    }

    public function copy_line_meta($item, $cart_item_key, $values, $order): void {
        if (empty($values['aryaman_quote_id'])) return;
        $item->add_meta_data('شناسه محاسبه آریامن', sanitize_text_field($values['aryaman_quote_id']), true);
        $item->add_meta_data('کد محاسبه آریامن', sanitize_text_field($values['aryaman_quote_code'] ?? ''), true);
        $item->add_meta_data('_aryaman_quote_id', sanitize_text_field($values['aryaman_quote_id']), true);
    }

    public function copy_order_meta($order, $data): void {
        if (!function_exists('WC') || !WC()->cart) return;
        foreach (WC()->cart->get_cart() as $cart_item) {
            if (!empty($cart_item['aryaman_quote_id'])) {
                $order->update_meta_data(self::QUOTE_META, sanitize_text_field($cart_item['aryaman_quote_id']));
                $order->update_meta_data('_aryaman_quote_code', sanitize_text_field($cart_item['aryaman_quote_code'] ?? ''));
                break;
            }
        }
    }

    public function send_order_event($order_id, string $event_type): void {
        if (!class_exists('WooCommerce')) return;
        $order = wc_get_order($order_id);
        if (!$order) return;
        $quote_id = (string) $order->get_meta(self::QUOTE_META, true);
        if (!$quote_id) return;
        $event_key = 'wp-' . md5(home_url('/') . '|' . $order_id . '|' . $event_type);
        $result = $this->proxy([
            'action' => 'site_event',
            'event_type' => $event_type,
            'quote_id' => $quote_id,
            'site_order_id' => (string) $order->get_order_number(),
            'status' => $order->get_status(),
            'reason' => $event_type === 'order_cancelled' ? 'لغو/بازپرداخت سفارش در WooCommerce' : '',
        ], $event_key);
        if (is_wp_error($result)) {
            $order->add_order_note('خطای ارسال رویداد به اتوماسیون آریامن: ' . $result->get_error_message());
        } else {
            $order->add_order_note('رویداد «' . $event_type . '» با موفقیت به اتوماسیون آریامن ارسال شد.');
        }
    }

    private function proxy(array $payload, string $event_id) {
        $options = $this->options();
        $endpoint = (string) $options['endpoint_url'];
        $secret = (string) $options['shared_secret'];
        if (!$endpoint || strlen($secret) < 32) return new WP_Error('connector_not_configured', 'اتصال امن مرکز محاسبه هنوز پیکربندی نشده است.', ['status' => 503]);
        $timestamp = (string) time();
        // Some hosts strip custom X- headers; timestamp/eventId also travel inside
        // the signed body so the handshake survives both worlds.
        $payload['wp_timestamp'] = $timestamp;
        $payload['wp_event_id'] = $event_id;
        // Key inside the encrypted body: invisible to URL logs, survives header stripping.
        $payload['wp_api_key'] = $secret;
        $json = wp_json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $signature = hash_hmac('sha256', $timestamp . '.' . $event_id . '.' . $json, $secret);
        // Hosts that strip custom X- headers also strip the signature header; query
        // params cannot be stripped, so all three travel on the URL as well.
        $request_url = add_query_arg([
            'api_key' => $secret,
            'aryaman_ts' => $timestamp,
            'aryaman_event' => $event_id,
            'aryaman_sig' => 'v1=' . $signature,
        ], $endpoint);
        $response = wp_remote_post($request_url, [
            'timeout' => 20,
            'redirection' => 0,
            'headers' => [
                'Content-Type' => 'application/json',
                'X-Ariaman-Timestamp' => $timestamp,
                'X-Ariaman-Event-Id' => $event_id,
                'X-Ariaman-Signature' => 'v1=' . $signature,
            ],
            'body' => $json,
            'data_format' => 'body',
        ]);
        if (is_wp_error($response)) return $response;
        $status = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);
        if ($status < 200 || $status >= 300) {
            $code = sanitize_text_field($body['code'] ?? '');
            $message = sanitize_text_field($body['error'] ?? 'خطا در سرویس محاسبه آریامن');
            if ($code !== '') $message .= ' [' . $code . ']';
            if (!empty($body['diag'])) $message .= ' {' . sanitize_text_field($body['diag']) . '}';
            if (!empty($body['errors']) && is_array($body['errors'])) {
                $msgs = [];
                foreach (array_slice($body['errors'], 0, 3) as $item) {
                    if (is_array($item)) { if (!empty($item['message'])) $msgs[] = sanitize_text_field((string) $item['message']); }
                    elseif (is_string($item) && $item !== '') $msgs[] = sanitize_text_field($item);
                }
                if ($msgs) $message .= ' {' . implode(' | ', $msgs) . '}';
            }
            $security_codes = ['WP_SECRET_MISSING', 'WP_TIMESTAMP', 'WP_SIGNATURE', 'WP_RATE_LIMIT', 'WP_FAILED'];
            if (in_array($code, $security_codes, true)) $message .= ' [secret=' . substr(hash('sha256', $secret), 0, 6) . ']';
            return new WP_Error('calculator_api_error', $message, ['status' => $status ?: 502]);
        }
        return rest_ensure_response(is_array($body) ? $body : []);
    }
}

Aryaman_Calculator_Connector::boot();
