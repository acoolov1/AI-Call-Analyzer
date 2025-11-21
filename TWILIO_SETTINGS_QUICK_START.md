# 🚀 Twilio Settings - Quick Start Guide

## What You Can Control Now

Your Twilio call handling is now **fully customizable** through the Settings page! Here's everything you can control:

---

## 📞 Call Forwarding

### Toggle Call Forwarding
- **ON**: Incoming calls forward to your phone
- **OFF**: Calls go straight to recording/voicemail

### Forward Phone Number
- Enter your office number: `+17175882255`
- Must include country code (+ and area code)
- Example: `+1` for USA, `+44` for UK

### Ring Duration
- **Slider**: 5 seconds to 2 minutes
- Default: 30 seconds
- How long your phone rings before going to voicemail

---

## 🎙️ Call Recording

### Toggle Recording
- **ON**: All calls are recorded and transcribed
- **OFF**: No recordings (you'll still see call logs)

### Recording Mode
- **From Answer**: Starts recording when call is answered
- **From Ringing**: Starts recording as soon as phone rings
- **Do Not Record**: Disables recording entirely

### Recording Beep
- **ON**: Plays "beep" sound before recording starts
- **OFF**: Silent recording start
- Tip: Some states require notification beep!

### Max Recording Length
- **Slider**: 1 minute to 4 hours (240 minutes)
- Default: 60 minutes (1 hour)
- Prevents storage waste on forgotten calls

### Finish Recording Key
- Press a key to stop recording early
- Options: `#` (default), `*`, `0`, `1`
- Useful for voicemail messages

---

## 💬 Custom Messages

### Custom Greeting
Replace the default "Thank you for calling..." with your own message:

**Examples:**
```
"Thank you for calling Acme Corp. Your call is being recorded and may be forwarded to an available representative."

"You've reached the sales department. Please hold while we connect you."

"Hi! Thanks for calling. This call will be recorded for quality assurance."
```

### After Hours Message
Set a message for calls outside business hours:

**Examples:**
```
"You've reached us outside of business hours. Please leave a message and we'll get back to you."

"Our office is currently closed. We're open Monday-Friday, 9am-5pm EST."
```

*(Note: Business hours scheduling coming soon!)*

---

## ⚙️ Recommended Settings

### **For Sales/Support Teams:**
```
✅ Call Forwarding: ON
📞 Forward Number: +17175882255
⏱️ Ring Duration: 30 seconds
🎙️ Recording: ON
📼 Recording Mode: From Answer
🔔 Recording Beep: ON
⏲️ Max Length: 60 minutes
🔑 Finish Key: #
💬 Greeting: "Thank you for calling [Company]. This call may be recorded."
```

### **For Voicemail Only:**
```
❌ Call Forwarding: OFF
🎙️ Recording: ON
📼 Recording Mode: From Answer
🔔 Recording Beep: ON
⏲️ Max Length: 10 minutes
🔑 Finish Key: #
💬 Greeting: "Please leave a message after the beep."
```

### **For Call Logging Only:**
```
✅ Call Forwarding: ON
📞 Forward Number: +17175882255
⏱️ Ring Duration: 45 seconds
❌ Recording: OFF
💬 Greeting: "Thank you for calling. You will be connected shortly."
```

---

## 🎯 How It Works

### When Someone Calls Your Twilio Number:

1. **Twilio receives the call**
2. **Your greeting plays** (if you set one)
3. **Call forwards to your number** (if enabled)
   - Rings for the duration you set
   - Records the conversation (if enabled)
4. **If you don't answer:**
   - Recording continues for voicemail
   - Caller can press finish key to end message
5. **After call ends:**
   - Recording is transcribed
   - AI analyzes the conversation
   - Everything appears in your dashboard

---

## 💡 Tips & Best Practices

### 1. **Legal Compliance**
- Enable "Recording Beep" in states that require notification
- Include recording notice in your greeting
- Check your local laws about call recording

### 2. **Professional Greetings**
- Keep it short (under 10 seconds)
- State your company name
- Mention the call may be recorded
- Set expectations ("connecting you now...")

### 3. **Ring Duration**
- **30-45 seconds**: Good balance for most businesses
- **15-20 seconds**: Fast-paced customer service
- **60+ seconds**: When you really don't want to miss calls

### 4. **Recording Length**
- **5-10 minutes**: Voicemail messages
- **30-60 minutes**: Normal business calls
- **120+ minutes**: Long consultations or support calls

### 5. **Finish Key**
- Keep default `#` for familiarity
- Most people know to press # to finish voicemail
- Only change if you have a specific need

---

## 🔄 Making Changes

### All settings auto-save!
1. Go to Settings → Twilio Call Settings
2. Toggle, slide, or type your changes
3. Settings save automatically (watch for ✓ confirmation)
4. Changes take effect on the **next call**

### Current calls are not affected
- Settings only apply to new incoming calls
- If someone is currently on the phone, their call continues with old settings

---

## 📱 Your Current Setup

Based on your environment:
- **Twilio Number**: (configured in Twilio console)
- **Current Forward Number**: `7175882255`
- **Default Settings**: All enabled with standard options

**Action Items:**
1. ✅ Database migration ran successfully
2. ✅ Backend and frontend servers running
3. 🔲 **Go to Settings page** and configure your preferences!
4. 🔲 **Test with a call** to your Twilio number

---

## 🆘 Quick Troubleshooting

### "Settings not saving"
- Check that both backend and frontend are running
- Look for error messages in browser console (F12)
- Verify you're logged in

### "Call not forwarding"
- Make sure "Call Forwarding" toggle is ON
- Phone number must include `+` and country code
- Example: `+17175882255` (not `7175882255`)

### "Recording not working"
- Check "Call Recording" toggle is ON
- Verify mode is not "Do Not Record"
- Look for recording in dashboard after call ends

### "Custom greeting not playing"
- Make sure text is entered (not blank)
- Avoid special XML characters (<, >, &)
- Check backend console logs during test call

---

## 🎉 You're All Set!

Your Twilio call handling is now completely under your control. No more editing environment variables or restarting servers—just toggle and go!

**Next Steps:**
1. Open your app: `http://localhost:3001/settings`
2. Scroll to "Twilio Call Settings"
3. Configure your preferences
4. Make a test call to verify everything works!

---

**Need Help?** Check `TWILIO_SETTINGS_IMPLEMENTATION.md` for detailed technical documentation.

