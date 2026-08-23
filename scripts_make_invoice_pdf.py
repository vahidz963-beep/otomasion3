from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import base64, re, io

ROOT = Path('/home/user/Otomasion2')
reporting = (ROOT/'src/lib/reporting.js').read_text()
logo_match = re.search(r"export const ARYAMAN_LOGO_DATA_URI = 'data:image/png;base64,([^']+)'", reporting)
logo_img = None
if logo_match:
    logo_img = Image.open(io.BytesIO(base64.b64decode(logo_match.group(1)))).convert('RGBA')

DPI = 200
PX_PER_MM = DPI / 25.4

def mm(v): return int(round(v * PX_PER_MM))

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

def f(size, bold=False): return ImageFont.truetype(BOLD if bold else FONT, size)

fa_digits = str.maketrans('0123456789', '۰۱۲۳۴۵۶۷۸۹')
def fa(s): return str(s).translate(fa_digits)
def money(n): return fa(f"{int(n):,}") + ' ریال'

BLACK=(20,20,20); GRAY=(218,218,218); SOFT=(248,248,248); NAVY=(16,36,61)

def rtl(draw, xy, text, font, fill=BLACK, anchor='ra'):
    draw.text(xy, str(text), font=font, fill=fill, anchor=anchor, direction='rtl', language='fa')

def center(draw, box, text, font, fill=BLACK):
    x1,y1,x2,y2=box
    draw.text(((x1+x2)//2,(y1+y2)//2), str(text), font=font, fill=fill, anchor='mm', direction='rtl', language='fa')

def ltr(draw, xy, text, font, fill=BLACK, anchor='la'):
    draw.text(xy, str(text), font=font, fill=fill, anchor=anchor)

def rect(draw, box, outline=BLACK, width=2, fill=None):
    draw.rectangle(box, outline=outline, width=width, fill=fill)

def paste_logo(img, x, y, w, h):
    if not logo_img: return
    logo = logo_img.copy()
    logo.thumbnail((w,h), Image.LANCZOS)
    img.alpha_composite(logo, (x + (w-logo.width)//2, y + (h-logo.height)//2))

def make_invoice(landscape=True):
    W,H = (mm(297), mm(210)) if landscape else (mm(210), mm(297))
    img = Image.new('RGBA', (W,H), 'white')
    draw = ImageDraw.Draw(img)
    margin = mm(10)
    sheet = (margin, margin, W-margin, H-margin)
    rect(draw, sheet, width=3)
    x1,y1,x2,y2 = sheet
    cur = y1
    # Header
    header_h = mm(15 if landscape else 17)
    rect(draw, (x1,cur,x2,cur+header_h), width=2)
    paste_logo(img, x2-mm(38), cur+mm(2), mm(30), mm(10))
    rtl(draw, (x1+mm(36), cur+mm(4)), 'شماره: PF-۱۴۰۵-۰۰۰۰۱', f(24 if landscape else 21, True), anchor='la')
    rtl(draw, (x1+mm(36), cur+mm(10)), 'تاریخ: ۱۴۰۵/۰۵/۲۷', f(22 if landscape else 20, True), anchor='la')
    center(draw, (x1,cur,x2,cur+mm(9)), '( پیش‌فاکتور فروش )', f(28 if landscape else 26, True))
    center(draw, (x1,cur+mm(8),x2,cur+header_h), 'پیشرو الکترونیک آریامن پارس', f(14 if landscape else 13))
    cur += header_h
    # seller compact
    sec_h = mm(7)
    rect(draw,(x1,cur,x2,cur+sec_h),width=2,fill=GRAY); center(draw,(x1,cur,x2,cur+sec_h),'مشخصات فروشنده',f(18 if landscape else 16,True)); cur+=sec_h
    seller_h = mm(19 if landscape else 24)
    rect(draw,(x1,cur,x2,cur+seller_h),width=2)
    if landscape:
        cols=[x2-mm(5), x2-mm(75), x2-mm(135), x2-mm(195)]
        rtl(draw,(cols[0],cur+mm(5)),'شرکت: پیشرو الکترونیک آریامن پارس',f(16,True))
        rtl(draw,(cols[1],cur+mm(5)),'شماره اقتصادی: ۱۴۰۰۹۴۶۷۲۵۹',f(16))
        rtl(draw,(cols[2],cur+mm(5)),'شماره ثبت: ۱۳۴۵۲',f(16))
        rtl(draw,(cols[0],cur+mm(11)),'کد پستی: ۷۵۱۶۹ - ۱۳۸۱۷',f(16))
        rtl(draw,(cols[1],cur+mm(11)),'تلفن: ۰۹۱۷۳۷۴۲۹۶۶',f(16))
        rtl(draw,(cols[0],cur+mm(17)),'نشانی: بوشهر، بهمنی، خلیج فارس، پردیس فناوری',f(16))
    else:
        rtl(draw,(x2-mm(5),cur+mm(5)),'شرکت: پیشرو الکترونیک آریامن پارس',f(15,True))
        rtl(draw,(x2-mm(5),cur+mm(11)),'شماره اقتصادی: ۱۴۰۰۹۴۶۷۲۵۹   شماره ثبت: ۱۳۴۵۲',f(15))
        rtl(draw,(x2-mm(5),cur+mm(17)),'کد پستی: ۷۵۱۶۹-۱۳۸۱۷   تلفن: ۰۹۱۷۳۷۴۲۹۶۶',f(15))
        rtl(draw,(x2-mm(5),cur+mm(23)),'نشانی: بوشهر، بهمنی، خلیج فارس، پردیس فناوری',f(15))
    cur+=seller_h
    # buyer compact
    rect(draw,(x1,cur,x2,cur+sec_h),width=2,fill=GRAY); center(draw,(x1,cur,x2,cur+sec_h),'مشخصات خریدار',f(18 if landscape else 16,True)); cur+=sec_h
    buyer_h=mm(22 if landscape else 28)
    rect(draw,(x1,cur,x2,cur+buyer_h),width=2)
    if landscape:
        rtl(draw,(x2-mm(5),cur+mm(5)),'نام شخص حقیقی / حقوقی: شرکت نمونه پارسیان تجهیز',f(16,True))
        rtl(draw,(x2-mm(95),cur+mm(5)),'شماره اقتصادی: ۱۴۰۰۹۴۸۹۸۴۹',f(16))
        rtl(draw,(x2-mm(160),cur+mm(5)),'شماره ثبت: ۴۵۸۹',f(16))
        rtl(draw,(x2-mm(5),cur+mm(11)),'شناسه ملی: ۱۴۰۰۹۴۸۹۸۴۹',f(16))
        rtl(draw,(x2-mm(95),cur+mm(11)),'کد پستی: ۷۶۱۳۷-۱۲۳۴۵',f(16))
        rtl(draw,(x2-mm(160),cur+mm(11)),'تلفن تماس: ۰۹۲۳۲۰۰۷۴۰۸',f(16))
        rtl(draw,(x2-mm(5),cur+mm(18)),'نشانی: بلوار غدیر، خیابان چراغ ۵، پلاک ۵',f(16))
    else:
        rtl(draw,(x2-mm(5),cur+mm(5)),'نام شخص حقیقی / حقوقی: شرکت نمونه پارسیان تجهیز',f(15,True))
        rtl(draw,(x2-mm(5),cur+mm(11)),'شماره اقتصادی: ۱۴۰۰۹۴۸۹۸۴۹   شماره ثبت: ۴۵۸۹',f(15))
        rtl(draw,(x2-mm(5),cur+mm(17)),'شناسه ملی: ۱۴۰۰۹۴۸۹۸۴۹   کد پستی: ۷۶۱۳۷-۱۲۳۴۵',f(15))
        rtl(draw,(x2-mm(5),cur+mm(23)),'تلفن: ۰۹۲۳۲۰۰۷۴۰۸   نشانی: بلوار غدیر، خیابان چراغ ۵',f(15))
    cur+=buyer_h
    # section label
    rect(draw,(x1,cur,x2,cur+sec_h),width=2,fill=GRAY); center(draw,(x1,cur,x2,cur+sec_h),'مشخصات کالا یا خدمات مورد معامله',f(18 if landscape else 16,True)); cur+=sec_h
    # table
    if landscape:
        widths_mm=[10,62,14,12,28,28,24,28,24,30]  # RTL from right
        font_sz=15; row_h=mm(8); head_h=mm(9)
    else:
        widths_mm=[8,39,12,10,20,20,17,20,17,20]
        font_sz=11; row_h=mm(6.2); head_h=mm(7)
    widths=[mm(w) for w in widths_mm]
    # scale widths to available
    avail=x2-x1
    scale=avail/sum(widths)
    widths=[int(w*scale) for w in widths]
    widths[-1]+=avail-sum(widths)
    headers=['ردیف','شرح کالا / خدمات','تعداد','واحد','مبلغ واحد','مبلغ کل','تخفیف','مبلغ خالص','مالیات','مبلغ نهایی']
    rows=[['۱','شرح کالای خدمت','۵','عدد','۵۰,۰۰۰,۰۰۰','۲۵۰,۰۰۰,۰۰۰','۰','۲۵۰,۰۰۰,۰۰۰','۲۵,۰۰۰,۰۰۰','۲۷۵,۰۰۰,۰۰۰']]
    # Add ghost rows? only 1 row sample but enough
    table_right=x2; y=cur
    # header cells from right to left
    xr=table_right
    for w,htext in zip(widths,headers):
        xl=xr-w; rect(draw,(xl,y,xr,y+head_h),width=2,fill=GRAY); center(draw,(xl,y,xr,y+head_h),htext,f(font_sz,True)); xr=xl
    y+=head_h
    for ri,r in enumerate(rows):
        xr=table_right
        for w,txt in zip(widths,r):
            xl=xr-w; rect(draw,(xl,y,xr,y+row_h),width=1,fill=SOFT if ri%2 else None); center(draw,(xl,y,xr,y+row_h),txt,f(font_sz,False)); xr=xl
        y+=row_h
    total_row=['','جمع کل','۵','','','۲۵۰,۰۰۰,۰۰۰','۰','۲۵۰,۰۰۰,۰۰۰','۲۵,۰۰۰,۰۰۰','۲۷۵,۰۰۰,۰۰۰']
    xr=table_right
    for w,txt in zip(widths,total_row):
        xl=xr-w; rect(draw,(xl,y,xr,y+row_h),width=1,fill=GRAY); center(draw,(xl,y,xr,y+row_h),txt,f(font_sz,True)); xr=xl
    y+=row_h; cur=y
    # totals compact
    totals_h=mm(31 if landscape else 36)
    left_w=mm(50 if landscape else 42)
    rect(draw,(x1,cur,x2,cur+totals_h),width=2)
    # totals table left
    tx1=x1; tx2=x1+left_w; labels=['جمع فاکتور','تخفیف','مالیات','قابل پرداخت','مانده فاکتور']; vals=['۲۷۵,۰۰۰,۰۰۰','۰','۲۵,۰۰۰,۰۰۰','۲۷۵,۰۰۰,۰۰۰','۲۷۵,۰۰۰,۰۰۰']
    rh=totals_h//5
    for i,(lab,val) in enumerate(zip(labels,vals)):
        yy=cur+i*rh; rect(draw,(tx1,yy,tx2,yy+rh),width=1,fill=SOFT if i%2 else None); rtl(draw,(tx2-mm(2),yy+rh//2),lab,f(font_sz,True),anchor='rm'); ltr(draw,(tx1+mm(2),yy+rh//2),val,f(font_sz,True),anchor='lm')
    rtl(draw,(x2-mm(5),cur+mm(9)),'مبلغ به حروف:',f(font_sz,True))
    rtl(draw,(x2-mm(45),cur+mm(9)),'دویست و هفتاد و پنج میلیون ریال',f(font_sz))
    rtl(draw,(x2-mm(5),cur+mm(19)),'مانده حساب نهایی:',f(font_sz,True))
    rtl(draw,(x2-mm(45),cur+mm(19)),'۲۷۵,۰۰۰,۰۰۰ ریال بدهکار می‌باشد.',f(font_sz))
    cur+=totals_h
    note_h=mm(13 if landscape else 15)
    rect(draw,(x1,cur,x2,cur+note_h),width=2); rtl(draw,(x2-mm(5),cur+mm(5)),'توضیحات: جزئیات زیر فاکتور و شرایط پرداخت در این قسمت چاپ می‌شود.',f(font_sz)); cur+=note_h
    # signatures at bottom only if room
    sig_y = max(cur+mm(5), y2-mm(28))
    for i,txt in enumerate(['امضاء فروشنده','امضاء خریدار','تحویل‌گیرنده']):
        cx=x1 + (i*2+1)*(x2-x1)//6
        center(draw,(cx-mm(30),sig_y,cx+mm(30),sig_y+mm(8)),txt,f(font_sz,True))
    # footer
    center(draw,(x1,y2-mm(7),x2,y2-mm(2)),'نمونه خروجی چاپ فشرده - یک ردیف کالا در یک صفحه',f(10))
    return img.convert('RGB')

pages=[make_invoice(True), make_invoice(False)]
out=ROOT/'invoice_print_preview_actual_compact.pdf'
pages[0].save(out, save_all=True, append_images=pages[1:], resolution=DPI)
print(out)
