<?php
/**
 * Plugin Name: Aryaman Warehouse Bridge
 * Plugin URI:  https://aryaman-co.ir
 * Description: پل همگام‌سازی انبار اتوماسیون آریامن (Supabase) با ووکامرس — رزرو پس از پرداخت، کسر پس از پایان تولید، آزادسازی پس از لغو، همگام‌سازی موجودی دوطرفه با صف تلاش مجدد، HMAC و لاگ کامل.
 * Version: 1.0.0
 * Author: Aryaman Automation
 * Text Domain: aryaman-warehouse-bridge
 * Requires PHP: 7.4
 * Requires at least: 5.8
 */

if (!defined('ABSPATH')) exit;

final class AryamanWarehouseBridge {

    const VERSION      = '1.0.0';
    const OPTION_KEY   = 'aryaman_bridge_settings';
    const SECRET_KEY   = 'aryaman_bridge_secret';
    const REST_NS      = 'aryaman-bridge/v1';
    const CRON_HOOK    = 'aryaman_bridge_queue_tick';
    const CAP          = 'manage_woocommerce';

    /** @var AryamanWarehouseBridge */
    private static $instance = null;

    private $settings = null;

    public static function instance(): AryamanWarehouseBridge {
        if (self::$instance === null) self::$instance = new self();
        return self::$instance;
    }

    private function __construct() {
        register_activation_hook(__FILE__, [__CLASS__, 'activate']);
        register_deactivation_hook(__FILE__, [__CLASS__, 'deactivate']);

        add_action('init', [$this, 'schedule_cron']);
        add_filter('cron_schedules', [$this, 'cron_interval']);
        add_action(self::CRON_HOOK, [$this, 'process_queue']);

        add_action('admin_menu', [$this, 'admin_menu']);
        add_action('admin_init', [$this, 'admin_init']);
        add_action('admin_enqueue_scripts', [$this, 'admin_assets']);
        add_action('rest_api_init', [$this, 'routes']);

        add_action('admin_post_aryaman_bridge_test', [$this, 'handle_connection_test']);
        add_action('admin_post_aryaman_bridge_fullsync', [$this, 'handle_full_sync']);
        add_action('admin_post_aryaman_bridge_regenerate_secret', [$this, 'handle_regenerate_secret']);

        /* پرداخت = رزرو در اتوماسیون */
        add_action('woocommerce_payment_complete', [$this, 'on_order_paid'], 20, 1);
        add_action('woocommerce_order_status_processing', [$this, 'on_order_paid'], 20, 1);

        /* لغو / برگشت = آزادسازی رزرو در اتوماسیون */
        add_action('woocommerce_order_status_cancelled', [$this, 'on_order_cancelled'], 20, 1);
        add_action('woocommerce_order_status_refunded', [$this, 'on_order_cancelled'], 20, 1);
    }

    /* ------------------------------------------------------------
     * فعال‌سازی: ساخت جدول‌های صف و لاگ + تولید راز HMAC
     * ------------------------------------------------------------ */
    public static function activate(): void {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();

        $queue = "CREATE TABLE {$wpdb->prefix}aryaman_bridge_queue (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            event_type VARCHAR(32) NOT NULL,
            event_id VARCHAR(64) NOT NULL,
            payload LONGTEXT NOT NULL,
            attempts INT NOT NULL DEFAULT 0,
            next_attempt_at DATETIME NOT NULL,
            last_error TEXT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            created_at DATETIME NOT NULL,
            UNIQUE KEY event_id (event_id),
            KEY status_next (status, next_attempt_at)
        ) $charset;";
        $logs = "CREATE TABLE {$wpdb->prefix}aryaman_bridge_logs (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            level VARCHAR(10) NOT NULL DEFAULT 'info',
            context VARCHAR(40) NOT NULL DEFAULT '',
            message TEXT NOT NULL,
            data LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            KEY created (created_at)
        ) $charset;";
        dbDelta([$queue, $logs]);

        if (!get_option(self::SECRET_KEY)) {
            update_option(self::SECRET_KEY, wp_generate_password(48, false, false));
        }
        $settings = get_option(self::OPTION_KEY);
        if (!is_array($settings)) {
            update_option(self::OPTION_KEY, self::defaults());
        }
    }

    public static function deactivate(): void {
        wp_clear_scheduled_hook(self::CRON_HOOK);
    }

    private static function defaults(): array {
        return [
            'supabase_url'        => '',
            'service_role_key'    => '',
            'shared_secret'       => '',   // همان WORDPRESS_SHARED_SECRET سمت اتوماسیون
            'stock_endpoint'      => '/functions/v1/warehouse-bridge',
            'enabled'             => 'no',
            'reserve_on'          => 'payment',
            'stock_status_low'    => 'outofstock',
            'auto_queue_retry'    => 'yes',
            'max_attempts'        => 5,
            'log_enabled'         => 'yes',
        ];
    }

    private function settings(): array {
        if ($this->settings === null) {
            $this->settings = wp_parse_args((array) get_option(self::OPTION_KEY, []), self::defaults());
        }
        return $this->settings;
    }

    private function secret(): string {
        $custom = trim((string) ($this->settings()['shared_secret'] ?? ''));
        if ($custom !== '') return $custom;
        return (string) get_option(self::SECRET_KEY, '');
    }

    private function log(string $level, string $context, string $message, $data = null): void {
        if ($this->settings()['log_enabled'] !== 'yes') return;
        global $wpdb;
        $wpdb->insert(
            "{$wpdb->prefix}aryaman_bridge_logs",
            [
                'level'      => in_array($level, ['info', 'warn', 'error'], true) ? $level : 'info',
                'context'    => substr($context, 0, 40),
                'message'    => $message,
                'data'       => $data !== null ? wp_json_encode($data) : null,
                'created_at' => current_time('mysql'),
            ],
            ['%s', '%s', '%s', '%s', '%s']
        );
    }

    /* ------------------------------------------------------------
     * امضای HMAC — هم‌الگوریتم با calculator-api اتوماسیون:
     * پیام = timestamp + '.' + eventId + '.' + body
     * هدرها: X-Aryaman-Timestamp / X-Aryaman-Event-Id / X-Aryaman-Signature
     * ------------------------------------------------------------ */
    private function sign(string $timestamp, string $eventId, string $body): string {
        return hash_hmac('sha256', $timestamp . '.' . $eventId . '.' . $body, $this->secret());
    }

    private function verify(string $timestamp, string $eventId, string $body, string $signature): bool {
        if (abs(time() - (int) $timestamp) > 300) return false; // پنجرهٔ ۵ دقیقه‌ای
        if ($eventId === '' || strlen($eventId) > 120) return false;
        return hash_equals($this->sign($timestamp, $eventId, $body), $signature);
    }

    /* ------------------------------------------------------------
     * ارسال خروجی به اتوماسیون — با صف و تلاش مجدد
     * ------------------------------------------------------------ */
    private function enqueue(string $eventType, array $payload): void {
        global $wpdb;
        $wpdb->insert(
            "{$wpdb->prefix}aryaman_bridge_queue",
            [
                'event_type'      => $eventType,
                'event_id'        => wp_generate_uuid4(),
                'payload'         => wp_json_encode($payload),
                'attempts'        => 0,
                'next_attempt_at' => current_time('mysql'),
                'status'          => 'pending',
                'created_at'      => current_time('mysql'),
            ],
            ['%s', '%s', '%s', '%d', '%s', '%s', '%s']
        );
        $this->log('info', 'queue', "رویداد {$eventType} در صف قرار گرفت", $payload);
        $this->process_queue();
    }

    public function process_queue(): void {
        global $wpdb;
        $settings = $this->settings();
        if ($settings['enabled'] !== 'yes') return;

        $max = max(1, (int) $settings['max_attempts']);
        $rows = $wpdb->get_results(
            "SELECT * FROM {$wpdb->prefix}aryaman_bridge_queue
             WHERE status = 'pending' AND next_attempt_at <= NOW()
             ORDER BY id ASC LIMIT 20",
            ARRAY_A
        );
        if (!$rows) return;

        $url = untrailingslashit($settings['supabase_url']) . $settings['stock_endpoint'];

        foreach ($rows as $row) {
            $body    = (string) $row['payload'];
            $ts      = (string) time();
            $eventId = (string) $row['event_id'];
            $attempt = (int) $row['attempts'] + 1;

            $response = wp_remote_post($url, [
                'timeout' => 20,
                'headers' => [
                    'Content-Type'           => 'application/json',
                    'X-Aryaman-Timestamp'    => $ts,
                    'X-Aryaman-Event-Id'     => $eventId,
                    'X-Aryaman-Signature'    => $this->sign($ts, $eventId, $body),
                    'X-Aryaman-Event'        => $row['event_type'],
                ],
                'body' => $body,
            ]);

            $ok    = !is_wp_error($response) && (int) wp_remote_retrieve_response_code($response) < 300;
            $error = is_wp_error($response) ? $response->get_error_message() : (string) wp_remote_retrieve_body($response);

            if ($ok) {
                $wpdb->update("{$wpdb->prefix}aryaman_bridge_queue",
                    ['status' => 'done'], ['id' => $row['id']], ['%s'], ['%d']);
                $this->log('info', 'send', "رویداد {$row['event_type']} #{$row['id']} ارسال شد");
            } elseif ($attempt >= $max) {
                $wpdb->update("{$wpdb->prefix}aryaman_bridge_queue",
                    ['status' => 'failed', 'attempts' => $attempt, 'last_error' => substr($error, 0, 900)],
                    ['id' => $row['id']], ['%s', '%d', '%s'], ['%d']);
                $this->log('error', 'send', "رویداد {$row['event_type']} #{$row['id']} بعد از {$attempt} تلاش شکست خورد", ['error' => $error]);
            } else {
                $delay = min(3600, 60 * pow(2, $attempt)); // backoff نمایی تا ۱ ساعت
                $wpdb->update("{$wpdb->prefix}aryaman_bridge_queue",
                    ['attempts' => $attempt, 'last_error' => substr($error, 0, 900),
                     'next_attempt_at' => gmdate('Y-m-d H:i:s', strtotime(current_time('mysql')) + $delay)],
                    ['id' => $row['id']], ['%d', '%s', '%s'], ['%d']);
                $this->log('warn', 'send', "رویداد {$row['event_type']} #{$row['id']} تلاش {$attempt} ناموفق؛ تلاش بعدی {$delay} ثانیه بعد", ['error' => $error]);
            }
        }
    }

    public function cron_interval($schedules): array {
        if (!isset($schedules['aryaman_bridge_5min'])) {
            $schedules['aryaman_bridge_5min'] = ['interval' => 300, 'display' => 'هر ۵ دقیقه (پل انبار آریامن)'];
        }
        return $schedules;
    }

    public function schedule_cron(): void {
        if ($this->settings()['auto_queue_retry'] === 'yes' && !wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time() + 120, 'aryaman_bridge_5min', self::CRON_HOOK);
        }
    }

    /* ------------------------------------------------------------
     * هوک‌های ووکامرس: پرداخت → رزرو | لغو → آزادسازی
     * ------------------------------------------------------------ */
    public function on_order_paid($order_id): void {
        $settings = $this->settings();
        if ($settings['enabled'] !== 'yes') return;
        $order = wc_get_order($order_id);
        if (!$order) return;

        $items = [];
        foreach ($order->get_items() as $item) {
            $code = $this->item_code_for_product($item->get_product_id());
            if ($code === '') continue;
            $items[] = ['item_code' => $code, 'qty' => (int) $item->get_quantity()];
        }
        if (!$items) return;

        $this->enqueue('order_reserve', [
            'event'     => 'order_reserve',
            'wc_order'  => $order->get_order_number(),
            'quote_id'  => $order->get_meta('_aryaman_quote_id'),
            'items'     => $items,
            'paid_at'   => $order->get_date_paid() ? $order->get_date_paid()->date('c') : null,
        ]);
    }

    public function on_order_cancelled($order_id): void {
        $settings = $this->settings();
        if ($settings['enabled'] !== 'yes') return;
        $order = wc_get_order($order_id);
        if (!$order) return;

        $items = [];
        foreach ($order->get_items() as $item) {
            $code = $this->item_code_for_product($item->get_product_id());
            if ($code === '') continue;
            $items[] = ['item_code' => $code, 'qty' => (int) $item->get_quantity()];
        }
        if (!$items) return;

        $this->enqueue('order_release', [
            'event'       => 'order_release',
            'wc_order'    => $order->get_order_number(),
            'quote_id'    => $order->get_meta('_aryaman_quote_id'),
            'items'       => $items,
        ]);
    }

    private function item_code_for_product(int $productId): string {
        $code = get_post_meta($productId, '_aryaman_item_code', true);
        if ($code !== '') return (string) $code;
        $product = wc_get_product($productId);
        if ($product && $product->get_sku()) return $product->get_sku(); // نگاشت پیش‌فرض: SKU == item_code
        return '';
    }

    /* ------------------------------------------------------------
     * REST ورودی: اتوماسیون تغییر موجودی را به ووکامرس می‌فرستد
     *   POST /wp-json/aryaman-bridge/v1/stock-update
     *   POST /wp-json/aryaman-bridge/v1/sync-batch   (دستگاهی؛ چند قلم هم‌زمان)
     * هدرها: X-Aryaman-Timestamp / X-Aryaman-Signature (HMAC-SHA256 روی ts.body)
     * بدنه: {"event":"stock_update","items":[{"item_code":"BOB-…","qty":123,"available":120}]}
     * ------------------------------------------------------------ */
    public function routes(): void {
        register_rest_route(self::REST_NS, '/stock-update', [
            'methods'             => 'POST',
            'callback'            => [$this, 'rest_stock_update'],
            'permission_callback' => [$this, 'rest_verify'],
        ]);
        register_rest_route(self::REST_NS, '/sync-batch', [
            'methods'             => 'POST',
            'callback'            => [$this, 'rest_stock_update'],
            'permission_callback' => [$this, 'rest_verify'],
        ]);
    }

    public function rest_verify(WP_REST_Request $request) {
        $ts  = (string) $request->get_header('x-aryaman-timestamp');
        $sig = (string) $request->get_header('x-aryaman-signature');
        $eid = (string) $request->get_header('x-aryaman-event-id');
        if ($ts === '' || $sig === '' || $eid === '') {
            return new WP_Error('ary_bridge_auth', 'هدرهای امضا ناقص است', ['status' => 401]);
        }
        $body = (string) $request->get_body();
        if (!$this->verify($ts, $eid, $body, $sig)) {
            $this->log('warn', 'auth', 'امضای درخواست ورودی نامعتبر بود', ['event_id' => $eid]);
            return new WP_Error('ary_bridge_auth', 'امضا یا زمان درخواست نامعتبر است', ['status' => 403]);
        }
        return true;
    }

    public function rest_stock_update(WP_REST_Request $request) {
        $settings = $this->settings();
        if ($settings['enabled'] !== 'yes') {
            return new WP_Error('ary_bridge_off', 'پل انبار غیرفعال است', ['status' => 409]);
        }
        $body  = json_decode((string) $request->get_body(), true);
        $items = is_array($body['items'] ?? null) ? $body['items'] : [];
        if (!$items) return new WP_Error('ary_bridge_input', 'بدنهٔ درخواست فاقد اقلام است', ['status' => 400]);

        $updated = [];
        foreach ($items as $row) {
            $code = trim((string) ($row['item_code'] ?? ''));
            $qty  = (int) ($row['available'] ?? $row['qty'] ?? 0);
            if ($code === '') continue;
            $productId = $this->product_id_for_item_code($code);
            if (!$productId) { $updated[] = ['item_code' => $code, 'result' => 'not_mapped']; continue; }

            $product = wc_get_product($productId);
            if (!$product) { $updated[] = ['item_code' => $code, 'result' => 'product_missing']; continue; }

            $low = $settings['stock_status_low'];
            wc_update_product_stock($product, $qty, 'set');
            if (function_exists('wc_get_product')) {
                $fresh = wc_get_product($productId);
                if ($fresh) {
                    if ($qty > 0) $fresh->set_stock_status('instock');
                    else $fresh->set_stock_status($low === 'onbackorder' ? 'onbackorder' : 'outofstock');
                    $fresh->save();
                }
            }
            $updated[] = ['item_code' => $code, 'result' => 'ok', 'qty' => $qty];
            $this->log('info', 'stock', "موجودی {$code} روی {$qty} به‌روزرسانی شد");
        }
        return rest_ensure_response(['ok' => true, 'updated' => $updated]);
    }

    private function product_id_for_item_code(string $code): int {
        global $wpdb;
        // ۱) متای اختصاصی ۲) SKU
        $id = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = '_aryaman_item_code' AND meta_value = %s LIMIT 1", $code));
        if ($id) return $id;
        $id = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT p.ID FROM {$wpdb->posts} p
             JOIN {$wpdb->postmeta} m ON m.post_id = p.ID AND m.meta_key = '_sku' AND m.meta_value = %s
             WHERE p.post_type IN ('product','product_variation') AND p.post_status = 'publish' LIMIT 1", $code));
        return $id;
    }

    /* ------------------------------------------------------------
     * صفحهٔ مدیریت
     * ------------------------------------------------------------ */
    public function admin_menu(): void {
        add_submenu_page(
            'woocommerce', 'پل انبار آریامن', 'پل انبار آریامن',
            self::CAP, 'aryaman-warehouse-bridge', [$this, 'render_admin']
        );
    }

    public function admin_assets($hook): void {
        if (strpos($hook, 'aryaman-warehouse-bridge') === false) return;
        wp_add_inline_style('wp-admin', '.arybr-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:920px}.arybr-grid .full{grid-column:1/-1}.arybr-card{background:#fff;border:1px solid #dcdcde;border-radius:10px;padding:16px}.arybr-hint{color:#646970;font-size:12px;line-height:1.7;margin-top:4px}.arybr-status{display:inline-block;border-radius:999px;padding:4px 12px;font-weight:700}.arybr-status.ok{background:#e7f7ee;color:#1c7a44}.arybr-status.bad{background:#fdf0ef;color:#a04038}.arybr-code{background:#f0f0f1;padding:10px;border-radius:8px;font-family:monospace;direction:ltr;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:11px}.arybr-table{width:100%;border-collapse:collapse}.arybr-table th,.arybr-table td{border-bottom:1px solid #e2e4e7;padding:7px;text-align:right;font-size:12.5px}');
    }

    public function admin_init(): void {
        register_setting('aryaman_bridge', self::OPTION_KEY, [
            'type' => 'array',
            'sanitize_callback' => function ($raw) {
                $d = self::defaults();
                $in = is_array($raw) ? $raw : [];
                $old = (array) get_option(self::OPTION_KEY, []);
                $key = trim($in['service_role_key'] ?? '');
                if ($key === '') $key = (string) ($old['service_role_key'] ?? ''); // خالی = بدون تغییر
                return [
                    'supabase_url'     => untrailingslashit(esc_url_raw(trim($in['supabase_url'] ?? ''))),
                    'service_role_key' => $key,
                    'shared_secret'    => trim($in['shared_secret'] ?? ''),
                    'stock_endpoint'   => trim($in['stock_endpoint'] ?? '/functions/v1/warehouse-bridge'),
                    'enabled'          => ($in['enabled'] ?? 'no') === 'yes' ? 'yes' : 'no',
                    'reserve_on'       => ($in['reserve_on'] ?? 'payment') === 'processing' ? 'processing' : 'payment',
                    'stock_status_low' => in_array($in['stock_status_low'] ?? 'outofstock', ['outofstock', 'onbackorder'], true) ? $in['stock_status_low'] : 'outofstock',
                    'auto_queue_retry' => ($in['auto_queue_retry'] ?? 'yes') === 'yes' ? 'yes' : 'no',
                    'max_attempts'     => max(1, min(20, (int) ($in['max_attempts'] ?? 5))),
                    'log_enabled'      => ($in['log_enabled'] ?? 'yes') === 'yes' ? 'yes' : 'no',
                ];
            },
        ]);
    }

    public function handle_connection_test(): void {
        if (!current_user_can(self::CAP)) wp_die('دسترسی مجاز نیست');
        check_admin_referer('aryaman_bridge_test');
        $settings = $this->settings();
        $url = untrailingslashit($settings['supabase_url']) . '/rest/v1/warehouse_items?select=item_code&limit=1';
        $res = wp_remote_get($url, [
            'timeout' => 15,
            'headers' => [
                'apikey'        => $settings['service_role_key'],
                'Authorization' => 'Bearer ' . $settings['service_role_key'],
            ],
        ]);
        $code = is_wp_error($res) ? 0 : (int) wp_remote_retrieve_response_code($res);
        set_transient('aryaman_bridge_test_result', $code === 200 ? 'ok' : 'fail:' . $code, 90);
        wp_safe_redirect(admin_url('admin.php?page=aryaman-warehouse-bridge'));
        exit;
    }

    public function handle_full_sync(): void {
        if (!current_user_can(self::CAP)) wp_die('دسترسی مجاز نیست');
        check_admin_referer('aryaman_bridge_fullsync');
        $settings = $this->settings();
        $url = untrailingslashit($settings['supabase_url']) . '/rest/v1/v_app_inventory_catalog?select=item_code,item_name_fa,current_qty,available_for_sale_qty&order=item_code.asc';
        $res = wp_remote_get($url, [
            'timeout' => 30,
            'headers' => [
                'apikey'        => $settings['service_role_key'],
                'Authorization' => 'Bearer ' . $settings['service_role_key'],
                'Range-Count'   => 'exact',
            ],
        ]);
        $body = is_wp_error($res) ? null : json_decode(wp_remote_retrieve_body($res), true);
        $synced = 0;
        if (is_array($body)) {
            foreach ($body as $row) {
                $code = trim((string) ($row['item_code'] ?? ''));
                if ($code === '') continue;
                $pid = $this->product_id_for_item_code($code);
                if (!$pid) continue;
                $product = wc_get_product($pid);
                if (!$product) continue;
                wc_update_product_stock($product, (int) $row['available_for_sale_qty'], 'set');
                $synced++;
            }
        }
        set_transient('aryaman_bridge_fullsync_result', is_array($body) ? 'ok:' . $synced : 'fail', 90);
        $this->log('info', 'fullsync', "همگام‌سازی کامل انجام شد؛ {$synced} قلم به‌روزرسانی شد");
        wp_safe_redirect(admin_url('admin.php?page=aryaman-warehouse-bridge'));
        exit;
    }

    public function handle_regenerate_secret(): void {
        if (!current_user_can(self::CAP)) wp_die('دسترسی مجاز نیست');
        check_admin_referer('aryaman_bridge_regenerate');
        update_option(self::SECRET_KEY, wp_generate_password(48, false, false));
        set_transient('aryaman_bridge_secret_regenerated', 'yes', 90);
        wp_safe_redirect(admin_url('admin.php?page=aryaman-warehouse-bridge'));
        exit;
    }

    public function render_admin(): void {
        if (!current_user_can(self::CAP)) return;
        $s = $this->settings();
        $test = get_transient('aryaman_bridge_test_result');
        $full = get_transient('aryaman_bridge_fullsync_result');
        $secret = $this->secret();
        global $wpdb;
        $queueStats = $wpdb->get_row("SELECT
            SUM(status='pending') AS pending,
            SUM(status='failed')  AS failed,
            SUM(status='done')    AS done
            FROM {$wpdb->prefix}aryaman_bridge_queue", ARRAY_A);
        $logs = $wpdb->get_results("SELECT * FROM {$wpdb->prefix}aryaman_bridge_logs ORDER BY id DESC LIMIT 25", ARRAY_A);
        $serviceMasked = $s['service_role_key'] ? substr($s['service_role_key'], 0, 10) . '…' . substr($s['service_role_key'], -4) : '';
        ?>
        <div class="wrap" dir="rtl">
        <h1>پل انبار آریامن <span class="arybr-status <?php echo $s['enabled'] === 'yes' ? 'ok' : 'bad'; ?>"><?php echo $s['enabled'] === 'yes' ? 'فعال' : 'غیرفعال'; ?></span></h1>
        <p class="arybr-hint">همگام‌سازی انبار اتوماسیون (Supabase) با فروشگاه ووکامرس: پرداخت → رزرو، پایان تولید → کسر (از سمت اتوماسیون به ووکامرس)، لغو → آزادسازی.</p>

        <?php if ($test === 'ok') echo '<div class="notice notice-success"><p>اتصال به اتوماسیون موفق بود ✓</p></div>'; ?>
        <?php if (is_string($test) && strpos($test, 'fail') === 0) echo '<div class="notice notice-error"><p>اتصال ناموفق (کد ' . esc_html($test) . ') — URL و کلید service_role را بررسی کنید.</p></div>'; ?>
        <?php if (is_string($full) && strpos($full, 'ok') === 0) echo '<div class="notice notice-success"><p>همگام‌سازی کامل انجام شد: ' . esc_html(substr($full, 3)) . ' قلم به‌روزرسانی شد.</p></div>'; ?>
        <?php if (is_string($full) && $full === 'fail') echo '<div class="notice notice-error"><p>همگام‌سازی کامل ناموفق بود — اتصال را تست کنید.</p></div>'; ?>

        <form method="post" action="options.php">
        <?php settings_fields('aryaman_bridge'); ?>
        <div class="arybr-grid">
            <div class="arybr-card full">
                <h2>اتصال به اتوماسیون</h2>
                <table class="form-table">
                    <tr><th>فعال‌سازی پل</th><td><select name="<?php echo self::OPTION_KEY; ?>[enabled]">
                        <option value="yes" <?php selected($s['enabled'], 'yes'); ?>>فعال</option>
                        <option value="no" <?php selected($s['enabled'], 'no'); ?>>غیرفعال</option>
                    </select></td></tr>
                    <tr><th>آدرس Supabase</th><td><input class="regular-text ltr" type="url" name="<?php echo self::OPTION_KEY; ?>[supabase_url]" value="<?php echo esc_attr($s['supabase_url']); ?>" placeholder="https://xxxx.supabase.co">
                        <p class="arybr-hint">بدون اسلش انتهایی.</p></td></tr>
                    <tr><th>کلید service_role</th><td><input class="regular-text ltr" type="password" name="<?php echo self::OPTION_KEY; ?>[service_role_key]" value="" placeholder="<?php echo $serviceMasked ? esc_attr($serviceMasked) : 'sb_secret_…'; ?>" autocomplete="new-password">
                        <p class="arybr-hint">فقط سمت سرور استفاده می‌شود و هرگز به مرورگر فرستاده نمی‌شود. برای تغییر دوباره تایپ کنید؛ خالی بماند بدون تغییر می‌ماند.</p></td></tr>
                    <tr><th>مسیر تابع انبار</th><td><input class="regular-text ltr" type="text" name="<?php echo self::OPTION_KEY; ?>[stock_endpoint]" value="<?php echo esc_attr($s['stock_endpoint']); ?>">
                        <p class="arybr-hint">مسیر Edge Function سمت اتوماسیون که رویدادهای رزرو/آزادسازی را می‌پذیرد.</p></td></tr>
                    <tr><th>راز مشترک HMAC</th><td><input class="regular-text ltr" type="text" name="<?php echo self::OPTION_KEY; ?>[shared_secret]" value="" placeholder="همان WORDPRESS_SHARED_SECRET اتوماسیون" autocomplete="off">
                        <p class="arybr-hint">اگر خالی بماند، راز داخلی زیر استفاده می‌شود (دو راز باید با تنظیمات اتوماسیون یکی باشد).<br>
                        <span class="arybr-code"><?php echo esc_html($secret); ?></span>
                        <a class="button" href="<?php echo wp_nonce_url(admin_url('admin-post.php?action=aryaman_bridge_regenerate_secret'), 'aryaman_bridge_regenerate'); ?>">تولید راز جدید</a></p></td></tr>
                </table>
            </div>

            <div class="arybr-card">
                <h2>رفتار همگام‌سازی</h2>
                <table class="form-table">
                    <tr><th>رزرو هنگام</th><td><select name="<?php echo self::OPTION_KEY; ?>[reserve_on]">
                        <option value="payment" <?php selected($s['reserve_on'], 'payment'); ?>>پرداخت موفق (payment_complete)</option>
                        <option value="processing" <?php selected($s['reserve_on'], 'processing'); ?>>ورود به وضعیت در حال پردازش</option>
                    </select></td></tr>
                    <tr><th>وضعیت وقتی موجودی صفر است</th><td><select name="<?php echo self::OPTION_KEY; ?>[stock_status_low]">
                        <option value="outofstock" <?php selected($s['stock_status_low'], 'outofstock'); ?>>ناموجود</option>
                        <option value="onbackorder" <?php selected($s['stock_status_low'], 'onbackorder'); ?>>پیش‌خرید</option>
                    </select></td></tr>
                    <tr><th>تلاش مجدد خودکار صف</th><td><select name="<?php echo self::OPTION_KEY; ?>[auto_queue_retry]">
                        <option value="yes" <?php selected($s['auto_queue_retry'], 'yes'); ?>>بله (cron هر ۵ دقیقه، backoff نمایی)</option>
                        <option value="no" <?php selected($s['auto_queue_retry'], 'no'); ?>>خیر</option>
                    </select></td></tr>
                    <tr><th>حداکثر تلاش هر رویداد</th><td><input type="number" min="1" max="20" name="<?php echo self::OPTION_KEY; ?>[max_attempts]" value="<?php echo esc_attr($s['max_attempts']); ?>"></td></tr>
                    <tr><th>ثبت لاگ</th><td><select name="<?php echo self::OPTION_KEY; ?>[log_enabled]">
                        <option value="yes" <?php selected($s['log_enabled'], 'yes'); ?>>بله</option>
                        <option value="no" <?php selected($s['log_enabled'], 'no'); ?>>خیر</option>
                    </select></td></tr>
                </table>
                <?php submit_button('ذخیرهٔ تنظیمات'); ?>
            </div>

            <div class="arybr-card">
                <h2>نگاشت محصولات</h2>
                <p class="arybr-hint">هر محصول ووکامرس با یکی از دو روش به قلم انبار وصل می‌شود:
                ۱) فیلد اختصاصی <code>_aryaman_item_code</code> ۲) برابر بودن SKU با کد قلم انبار.
                کدهای انبار را عیناً از اتوماسیون بگیرید (مثلاً <code>BOB-PQ3230-V66</code> یا <code>TAPE-MYLAR-W12</code>).</p>
            </div>

            <div class="arybr-card">
                <h2>ابزارها</h2>
                <p><a class="button button-primary" href="<?php echo wp_nonce_url(admin_url('admin-post.php?action=aryaman_bridge_test'), 'aryaman_bridge_test'); ?>">تست اتصال به اتوماسیون</a>
                <a class="button" href="<?php echo wp_nonce_url(admin_url('admin-post.php?action=aryaman_bridge_fullsync'), 'aryaman_bridge_fullsync'); ?>">همگام‌سازی کامل موجودی</a></p>
                <p class="arybr-hint">صف: <?php echo (int) $queueStats['pending']; ?> در انتظار · <?php echo (int) $queueStats['failed']; ?> شکست‌خورده · <?php echo (int) $queueStats['done']; ?> ارسال‌شده.</p>
            </div>

            <div class="arybr-card full">
                <h2>قرارداد endpoints (برای سمت اتوماسیون)</h2>
                <p class="arybr-hint">ورودی از اتوماسیون — امضای HMAC-SHA256 روی <code>timestamp + '.' + eventId + '.' + body</code> با راز مشترک (هم‌الگوریتم calculator-api):</p>
                <div class="arybr-code">POST <?php echo esc_html(rest_url(self::REST_NS . '/stock-update')); ?>
POST <?php echo esc_html(rest_url(self::REST_NS . '/sync-batch')); ?>
Headers: X-Aryaman-Timestamp / X-Aryaman-Event-Id / X-Aryaman-Signature
Body: {"event":"stock_update","items":[{"item_code":"BOB-PQ3230-V66","qty":450,"available":447}]}</div>
                <p class="arybr-hint">خروجی به اتوماسیون — از سمت ووکامرس با همان هدرها:</p>
                <div class="arybr-code">event: order_reserve  → { wc_order, quote_id, items:[{item_code, qty}] }   (پرداخت = رزرو)
event: order_release  → { wc_order, quote_id, items:[{item_code, qty}] }   (لغو/برگشت = آزادسازی)</div>
            </div>

            <div class="arybr-card full">
                <h2>آخرین لاگ‌ها</h2>
                <table class="arybr-table"><thead><tr><th>زمان</th><th>سطح</th><th>زمینه</th><th>پیام</th></tr></thead><tbody>
                <?php foreach ((array) $logs as $row) : ?>
                    <tr><td><?php echo esc_html($row['created_at']); ?></td>
                    <td><?php echo esc_html($row['level']); ?></td>
                    <td><?php echo esc_html($row['context']); ?></td>
                    <td><?php echo esc_html($row['message']); ?></td></tr>
                <?php endforeach; if (!$logs) echo '<tr><td colspan="4">لاگی ثبت نشده است.</td></tr>'; ?>
                </tbody></table>
            </div>
        </div>
        </form>
        </div>
        <?php
    }
}

AryamanWarehouseBridge::instance();
