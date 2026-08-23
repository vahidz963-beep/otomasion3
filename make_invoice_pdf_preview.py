from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import base64, re, io, html

ROOT = Path('/home/user/Otomasion2')
reporting = (ROOT / 'src/lib/reporting.js').read_text()
m = re.search(r"export const ARYAMAN_LOGO_DATA_URI = 'data:image/png;base64,([^']+)'", reporting)
logo_img = Image.open(io.BytesIO(base64.b64decode(m.group(1)))).convert('RGBA') if m else None
DPI = 200
PX = DPI / 25.4

def mm(v): return int(round(v * PX))
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
def font(size, bold=False): return ImageFont.truetype(BOLD if bold else FONT, size)
fa_map = str.maketrans('0123456789', '۰۱۲۳۴۵۶۷۸۹')
def fa(v): return str(v).translate(fa_map)
def money(n): return fa(f'{int(n):,}') + ' ریال'
BLACK = (10, 10, 10)
GRAY = (218, 218, 218)
SOFT = (248, 248, 248)

def draw_rtl(draw, xy, text, ft, fill=BLACK, anchor='ra'):
    draw.text(xy, str(text), font=ft, fill=fill, anchor=anchor, direction='rtl', language='fa')

def draw_center(draw, box, text, ft, fill=BLACK):
    x1, y1, x2, y2 = box
    draw.text(((x1+x2)//2, (y1+y2)//2), str(text), font=ft, fill=fill, anchor='mm', direction='rtl', language='fa')

def draw_ltr(draw, xy, text, ft, fill=BLACK, anchor='la'):
    draw.text(xy, str(text), font=ft, fill=fill, anchor=anchor)

def rect(draw, box, fill=None, width=2):
    draw.rectangle(box, outline=BLACK, fill=fill, width=width)

def put_logo(img, box):
    if not logo_img: return
    x1,y1,x2,y2 = box
    logo = logo_img.copy()
    logo.thumbnail((x2-x1, y2-y1), Image.LANCZOS)
    img.alpha_composite(logo, (x1+(x2-x1-logo.width)//2, y1+(y2-y1-logo.height)//2))

def make_page(landscape=True):
    W, H = (mm(297), mm(210)) if landscape else (mm(210), mm(297))
    img = Image.new('RGBA', (W,H), 'white')
    d = ImageDraw.Draw(img)
    margin = mm(10)
    x1,y1,x2,y2 = margin, margin, W-margin, H-margin
    rect(d, (x1,y1,x2,y2), width=3)
    fs_title = 28 if landscape else 23
    fs_h = 17 if landscape else 14
    fs = 15 if landscape else 12
    fs_table = 13 if landscape else 10
    cur = y1
    header_h = mm(15 if landscape else 17)
    rect(d, (x1,cur,x2,cur+header_h), width=2)
    put_logo(img, (x2-mm(36 if landscape else 30), cur+mm(2), x2-mm(5), cur+mm(13)))
    draw_ltr(d, (x1+mm(4), cur+mm(4)), 'PF-1405-00001 :شماره', font(fs_h, True))
    draw_ltr(d, (x1+mm(4), cur+mm(10)), '1405/05/27 :تاریخ', font(fs_h, True))
    draw_center(d, (x1, cur, x2, cur+mm(9)), '( پیش‌فاکتور فروش )', font(fs_title, True))
    draw_center(d, (x1, cur+mm(8), x2, cur+header_h), 'پیشرو الکترونیک آریامن پارس', font(12 if landscape else 10))
    cur += header_h
    sec_h = mm(7 if landscape else 6)
    for title, lines in [
        ('مشخصات فروشنده', [
            'شرکت: پیشرو الکترونیک آریامن پارس', 'شماره اقتصادی: ۱۴۰۰۹۴۶۷۲۵۹', 'شماره ثبت: ۱۳۴۵۲',
            'کد پستی: ۷۵۱۶۹-۱۳۸۱۷', 'تلفن: ۰۹۱۷۳۷۴۲۹۶۶', 'نشانی: بوشهر، بهمنی، خلیج فارس، پردیس فناوری']),
        ('مشخصات خریدار', [
            'نام: شرکت نمونه پارسیان تجهیز', 'شماره اقتصادی: ۱۴۰۰۹۴۸۹۸۴۹', 'شماره ثبت: ۴۵۸۹',
            'شناسه ملی: ۱۴۰۰۹۴۸۹۸۴۹', 'کد پستی: ۷۶۱۳۷-۱۲۳۴۵', 'تلفن: ۰۹۲۳۲۰۰۷۴۰۸'])]:
        rect(d, (x1,cur,x2,cur+sec_h), fill=GRAY, width=2)
        draw_center(d, (x1,cur,x2,cur+sec_h), title, font(fs_h, True))
        cur += sec_h
        box_h = mm(18 if landscape else 24)
        rect(d, (x1,cur,x2,cur+box_h), width=2)
        if landscape:
            positions = [(x2-mm(5),cur+mm(4)), (x2-mm(78),cur+mm(4)), (x2-mm(145),cur+mm(4)),
                         (x2-mm(5),cur+mm(10)), (x2-mm(78),cur+mm(10)), (x2-mm(5),cur+mm(16))]
        else:
            positions = [(x2-mm(5),cur+mm(4)), (x2-mm(5),cur+mm(10)), (x2-mm(5),cur+mm(16)),
                         (x2-mm(5),cur+mm(22)), (x2-mm(80),cur+mm(10)), (x2-mm(80),cur+mm(16))]
        for pos, line in zip(positions, lines):
            draw_rtl(d, pos, line, font(fs, True if 'شرکت:' in line or 'نام:' in line else False))
        cur += box_h
    # items title
    rect(d, (x1,cur,x2,cur+sec_h), fill=GRAY, width=2)
    draw_center(d, (x1,cur,x2,cur+sec_h), 'مشخصات کالا یا خدمات مورد معامله', font(fs_h, True))
    cur += sec_h
    headers = ['ردیف','شرح کالا / خدمات','تعداد','واحد','فی ریال','مبلغ کل','تخفیف','خالص','مالیات','نهایی']
    if landscape:
        widths = [mm(v) for v in [9,64,14,12,27,27,22,27,23,29]]
        row_h, head_h = mm(7.1), mm(8)
    else:
        widths = [mm(v) for v in [7,40,10,9,20,20,16,20,16,20]]
        row_h, head_h = mm(5.3), mm(6.2)
    scale = (x2-x1)/sum(widths)
    widths = [int(w*scale) for w in widths]
    widths[-1] += (x2-x1)-sum(widths)
    def table_row(y, values, fill=None, bold=False):
        xr = x2
        for w, val in zip(widths, values):
            xl = xr - w
            rect(d, (xl,y,xr,y+row_h), fill=fill, width=1)
            draw_center(d, (xl,y,xr,y+row_h), val, font(fs_table, bold))
            xr = xl
    # header
    xr=x2
    for w,h in zip(widths, headers):
        xl=xr-w; rect(d,(xl,cur,xr,cur+head_h),fill=GRAY,width=2); draw_center(d,(xl,cur,xr,cur+head_h),h,font(fs_table,True)); xr=xl
    cur += head_h
    table_row(cur, ['۱','شرح کالای خدمت','۵','عدد','۵۰,۰۰۰,۰۰۰','۲۵۰,۰۰۰,۰۰۰','۰','۲۵۰,۰۰۰,۰۰۰','۲۵,۰۰۰,۰۰۰','۲۷۵,۰۰۰,۰۰۰'])
    cur += row_h
    table_row(cur, ['','جمع کل','۵','','','۲۵۰,۰۰۰,۰۰۰','۰','۲۵۰,۰۰۰,۰۰۰','۲۵,۰۰۰,۰۰۰','۲۷۵,۰۰۰,۰۰۰'], fill=GRAY, bold=True)
    cur += row_h
    # totals
    totals_h = mm(30 if landscape else 34)
    left_w = mm(50 if landscape else 43)
    rect(d, (x1,cur,x2,cur+totals_h), width=2)
    labels = ['جمع فاکتور','تخفیف','مالیات','قابل پرداخت','مانده فاکتور']
    vals = ['۲۷۵,۰۰۰,۰۰۰','۰','۲۵,۰۰۰,۰۰۰','۲۷۵,۰۰۰,۰۰۰','۲۷۵,۰۰۰,۰۰۰']
    rh = totals_h//5
    for i,(lab,val) in enumerate(zip(labels, vals)):
        yy = cur + i*rh
        rect(d, (x1,yy,x1+left_w,yy+rh), fill=SOFT if i%2 else None, width=1)
        draw_rtl(d, (x1+left_w-mm(2), yy+rh//2), lab, font(fs_table, True), anchor='rm')
        draw_ltr(d, (x1+mm(2), yy+rh//2), val, font(fs_table, True), anchor='lm')
    draw_rtl(d, (x2-mm(5), cur+mm(9)), 'مبلغ به حروف: دویست و هفتاد و پنج میلیون ریال', font(fs, True))
    draw_rtl(d, (x2-mm(5), cur+mm(20)), 'مانده حساب نهایی: ۲۷۵,۰۰۰,۰۰۰ ریال بدهکار می‌باشد.', font(fs, True))
    cur += totals_h
    note_h = mm(12 if landscape else 14)
    rect(d, (x1,cur,x2,cur+note_h), width=2)
    draw_rtl(d, (x2-mm(5),cur+mm(5)), 'توضیحات: جزئیات زیر فاکتور و شرایط پرداخت در این قسمت چاپ می‌شود.', font(fs))
    # signatures near bottom
    sig_y = y2 - mm(22 if landscape else 25)
    for i,txt in enumerate(['امضاء فروشنده','امضاء خریدار','تحویل‌گیرنده']):
        cx = x1 + (i*2+1)*(x2-x1)//6
        draw_center(d, (cx-mm(25), sig_y, cx+mm(25), sig_y+mm(7)), txt, font(fs_table, True))
    draw_center(d, (x1, y2-mm(6), x2, y2-mm(2)), 'نمونه خروجی چاپ فشرده - یک ردیف کالا در یک صفحه', font(10))
    return img.convert('RGB')

out = ROOT / 'invoice_print_preview_actual_compact.pdf'
pages = [make_page(True), make_page(False)]
pages[0].save(out, save_all=True, append_images=pages[1:], resolution=DPI)
print(str(out))
