# 📋 Twilio Settings Reference Card

Quick reference for all available Twilio settings you can control through the frontend.

---

## ⚙️ Available Settings

| Setting | Control Type | Default | Valid Range | Description |
|---------|--------------|---------|-------------|-------------|
| **Call Forwarding** | Toggle | ✅ ON | ON/OFF | Forward calls to your phone |
| **Forward Phone Number** | Text Input | (empty) | E.164 format* | Phone number to forward to |
| **Ring Duration** | Slider | 30 sec | 5-120 sec | How long phone rings |
| **Call Recording** | Toggle | ✅ ON | ON/OFF | Record calls for transcription |
| **Recording Mode** | Dropdown | From Answer | 3 options** | When to start recording |
| **Recording Beep** | Toggle | ✅ ON | ON/OFF | Play beep before recording |
| **Max Recording Length** | Slider | 60 min | 1-240 min | Maximum recording duration |
| **Finish Recording Key** | Dropdown | # | #, *, 0, 1 | Key to stop recording |
| **Custom Greeting** | Text Area | (empty) | Max 500 chars | Message played to callers |
| **After Hours Message*** | Text Area | (empty) | Max 500 chars | Message for after hours |

\* E.164 format: `+[country code][area code][number]` (e.g., `+17175882255`)  
\*\* Recording modes: `From Answer`, `From Ringing`, `Do Not Record`  
\*\*\* After Hours feature coming soon - requires business hours configuration

---

## 🎛️ Setting Details

### Call Forwarding

**When Enabled:**
- Incoming calls dial your forward number
- Rings for configured duration
- Can record the conversation
- Falls back to voicemail if no answer

**When Disabled:**
- Caller hears greeting message
- Call goes straight to recording/voicemail
- No phone rings
- Good for voicemail-only setup

---

### Forward Phone Number

**Format Requirements:**
- Must start with `+`
- Include country code
- Include area code
- No spaces, dashes, or parentheses

**Valid Examples:**
```
✅ +17175882255 (US)
✅ +442071234567 (UK)
✅ +61212345678 (Australia)
✅ +16135551234 (Canada)
```

**Invalid Examples:**
```
❌ 7175882255 (missing + and country code)
❌ +1 (717) 588-2255 (has formatting)
❌ +1 717 588 2255 (has spaces)
```

---

### Ring Duration

**Recommended Values:**
- **5-15 seconds**: Very urgent response needed
- **20-30 seconds**: Standard business calls
- **30-45 seconds**: Balanced (most common)
- **45-60 seconds**: Don't want to miss calls
- **60+ seconds**: Multiple people to check

**Technical Limit:** 5-120 seconds (enforced by slider)

---

### Recording Mode

#### 1. **Record from Answer** ⭐ (Default)
- Recording starts when call is answered
- Most efficient (no wasted recording time)
- Best for normal business use
- Doesn't record ring time

#### 2. **Record from Ringing**
- Recording starts when phone begins ringing
- Captures ring time and hold music
- Useful for quality control
- Slightly larger file sizes

#### 3. **Do Not Record**
- No recording created
- Call still appears in dashboard
- No transcription or AI analysis
- Saves storage space

---

### Recording Beep

**When Enabled (✅):**
- Plays audible "beep" sound before recording
- Required by law in some jurisdictions
- Professional and transparent
- Recommended for most businesses

**When Disabled (❌):**
- Silent recording start
- Only use if legal in your area
- More subtle experience

**⚠️ Legal Note:** Some states/countries require notification. Check local laws!

---

### Max Recording Length

**Common Scenarios:**

| Use Case | Recommended Length |
|----------|-------------------|
| Voicemail messages | 5-10 minutes |
| Quick inquiries | 15-30 minutes |
| Normal business calls | 30-60 minutes |
| Support calls | 60-120 minutes |
| Consultations | 120-180 minutes |
| Extended sessions | 180-240 minutes |

**Technical Limits:**
- Minimum: 60 seconds (1 minute)
- Maximum: 14,400 seconds (240 minutes / 4 hours)
- Default: 3,600 seconds (60 minutes / 1 hour)

---

### Finish Recording Key

**Purpose:** Allows caller to end their message early

**Options:**
- **# (Pound)** ⭐ - Most familiar to callers
- **\* (Star)** - Alternative option
- **0** - Numeric option
- **1** - Another numeric option

**When Used:**
- Voicemail messages
- Leaving callback information
- Quick status updates
- After-hours messages

**Example:** "Please leave a message after the beep. Press # when finished."

---

### Custom Greeting

**Best Practices:**

**✅ Good Examples:**
```
"Thank you for calling Acme Corporation. Your call may be recorded for quality purposes."

"You've reached the support desk. Please hold while we connect you to the next available representative."

"Hi! Thanks for calling. This call is being recorded and you'll be connected shortly."
```

**❌ Avoid:**
```
❌ Too long (over 15 seconds)
❌ Unclear or confusing
❌ Special characters: < > & ' "
❌ Multiple sentences without pauses
```

**Tips:**
- Keep it under 10-15 seconds
- State company name
- Mention recording (if required)
- Set expectations
- Use professional tone

---

### After Hours Message

**Status:** 🚧 Prepared for future business hours feature

**Use Case:**
When business hours scheduling is enabled, this message plays instead of the regular greeting when someone calls outside your operating hours.

**Good Examples:**
```
"You've reached us outside of business hours. We're open Monday through Friday, 9 AM to 5 PM Eastern Time. Please leave a message and we'll return your call during business hours."

"Thank you for calling. Our office is currently closed. Please leave a detailed message including your name and phone number, and we'll get back to you as soon as possible."
```

---

## 🔄 How Settings Are Applied

### Timing
1. You change a setting in the Settings page
2. Settings save automatically to database
3. **Next incoming call** uses new settings
4. **Current calls** continue with old settings

### Priority Order
1. **User-specific settings** (from Settings page)
2. **Environment variable** (`BUSINESS_PHONE_NUMBER`)
3. **Default values** (hard-coded in system)

---

## 💾 Where Settings Are Stored

### Database
```json
// users.twilio_settings column (JSONB)
{
  "forwardingEnabled": true,
  "forwardPhoneNumber": "+17175882255",
  "recordingEnabled": true,
  "callTimeout": 30,
  "customGreeting": "Thank you for calling...",
  "playRecordingBeep": true,
  "maxRecordingLength": 3600,
  "finishOnKey": "#",
  "afterHoursMessage": "",
  "recordingMode": "record-from-answer"
}
```

### API Endpoint
```http
PATCH /api/v1/user/preferences
Content-Type: application/json
Authorization: Bearer <token>

{
  "twilioSettings": {
    "forwardingEnabled": true,
    "forwardPhoneNumber": "+17175882255"
  }
}
```

---

## 🧪 Testing Your Settings

### 1. Configure Settings
- Go to Settings page
- Adjust Twilio Call Settings
- Wait for "Settings saved successfully!" message

### 2. Make Test Call
- Call your Twilio number from another phone
- Listen for custom greeting (if configured)
- Verify call forwards (if enabled)
- Check recording happens (if enabled)

### 3. Verify in Dashboard
- After call ends, check Calls page
- Verify recording appears
- Check transcription is generated
- Review AI analysis

---

## 📊 Common Configurations

### Configuration 1: "Full Service"
```
✅ Forwarding: ON → +17175882255 → 30s
✅ Recording: ON → From Answer → Beep: ON → 60 min → Key: #
📝 Greeting: "Thank you for calling Acme Corp. Your call is being recorded."
```

### Configuration 2: "Voicemail Only"
```
❌ Forwarding: OFF
✅ Recording: ON → From Answer → Beep: ON → 10 min → Key: #
📝 Greeting: "Please leave a message after the beep. Press # when done."
```

### Configuration 3: "Forward Only (No Recording)"
```
✅ Forwarding: ON → +17175882255 → 45s
❌ Recording: OFF
📝 Greeting: "Please hold while we connect you."
```

### Configuration 4: "Call Screening"
```
✅ Forwarding: ON → +17175882255 → 60s
✅ Recording: ON → From Ringing → Beep: OFF → 120 min → Key: *
📝 Greeting: "Your call is important. Recording from ring for quality."
```

---

## 🎯 Quick Decision Guide

### "Should I enable call forwarding?"
- **YES** if you want to answer calls on your phone
- **NO** if you only want voicemail messages

### "Should I enable recording?"
- **YES** if you want transcription and AI analysis
- **YES** if you need call records for compliance
- **NO** if you only need call logs

### "What ring duration should I use?"
- **20-30s** = Standard, balanced
- **45-60s** = Don't want to miss any calls
- **10-15s** = Quick response, always available

### "Should I use a custom greeting?"
- **YES** if you want to brand your calls
- **YES** if you need to state company name
- **YES** if you want to mention recording
- **NO** if default message is fine

---

## 📞 Support

If you need help with Twilio settings:

1. **Check the documentation:**
   - `TWILIO_SETTINGS_IMPLEMENTATION.md` - Full technical details
   - `TWILIO_SETTINGS_QUICK_START.md` - Getting started guide
   - This file - Quick reference

2. **Test your settings:**
   - Make a test call
   - Check browser console (F12) for errors
   - Review backend logs

3. **Common issues:**
   - Phone number format (must include + and country code)
   - Both servers running (backend and frontend)
   - Database migration completed successfully

---

**Last Updated:** Implementation completed with all Priority 1 & 2 features  
**Status:** ✅ Ready for production use  
**API Version:** v1

