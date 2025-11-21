import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import axios from "axios";
import OpenAI from "openai";
import fs from "fs";
import path from "path";

dotenv.config();

// File path for storing call history
const CALLS_FILE = path.join(process.cwd(), "calls-history.json");

// Load existing call history from file
let callHistory = [];
function loadCallHistory() {
  try {
    if (fs.existsSync(CALLS_FILE)) {
      const data = fs.readFileSync(CALLS_FILE, "utf8");
      callHistory = JSON.parse(data);
      console.log(`Loaded ${callHistory.length} call records from history`);
    }
  } catch (err) {
    console.error("Error loading call history:", err);
    callHistory = [];
  }
}

// Save call history to file
function saveCallHistory() {
  try {
    fs.writeFileSync(CALLS_FILE, JSON.stringify(callHistory, null, 2));
    console.log(`Saved ${callHistory.length} call records to history`);
  } catch (err) {
    console.error("Error saving call history:", err);
  }
}

// Load history on startup
loadCallHistory();

// Store caller numbers by CallSid to match with recordings
const callData = new Map();

const app = express();
// Twilio sends form-urlencoded data, so we need to parse it first
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json()); // Also support JSON for other endpoints

const port = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * 1️⃣ Endpoint to handle incoming calls
 * Twilio hits this when someone calls your number.
 * We respond with TwiML that RECORDS the call.
 */
app.post("/voice", (req, res) => {
  try {
    console.log("=== Voice webhook received ===");
    console.log("Request method:", req.method);
    console.log("Content-Type:", req.headers["content-type"]);
    console.log("Body keys:", Object.keys(req.body || {}));
    console.log("Body:", req.body);
    
    // Get host - try multiple sources
    let host = req.headers["host"];
    if (!host) {
      host = req.headers["x-forwarded-host"];
    }
    if (!host) {
      // Try to get from the request URL
      host = req.get("host");
    }
    
    // Default protocol
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
    
    // If still no host, we can't construct the URL properly
    if (!host) {
      console.error("ERROR: No host header found!");
      // Return a simple response that doesn't require a callback URL
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please configure your webhook URL with a proper host.</Say>
  <Hangup/>
</Response>`;
      res.type("text/xml");
      return res.status(200).send(twiml);
    }
    
    // Get business phone number from environment variable
    const businessPhoneNumber = process.env.BUSINESS_PHONE_NUMBER;
    if (!businessPhoneNumber) {
      console.error("ERROR: BUSINESS_PHONE_NUMBER environment variable not set!");
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please configure your business phone number.</Say>
  <Hangup/>
</Response>`;
      res.type("text/xml");
      return res.status(200).send(twiml);
    }
    
    // Capture caller number, caller name, and CallSid from the initial call
    const callerNumber = req.body.From || req.body.Caller || "Unknown";
    const callerName = req.body.FromName || req.body.CallerName || null;
    const callSid = req.body.CallSid;
    
    console.log(`Caller: ${callerNumber}${callerName ? ` (${callerName})` : ''}, CallSid: ${callSid}`);
    console.log(`Forwarding to: ${businessPhoneNumber}`);
    console.log(`Host: ${host}, Protocol: ${protocol}`);
    
    // Store caller info for later lookup
    if (callSid) {
      callData.set(callSid, { callerNumber, callerName, timestamp: new Date().toISOString() });
      console.log(`✓ Stored caller info for CallSid ${callSid}`);
    } else {
      console.log("⚠ No CallSid in voice webhook");
    }
    
    // Pass CallSid as query parameter so we can retrieve it when recording completes
    const recordingCompleteUrl = callSid 
      ? `${protocol}://${host}/recording-complete?CallSid=${encodeURIComponent(callSid)}`
      : `${protocol}://${host}/recording-complete`;
    
    console.log("Recording complete URL:", recordingCompleteUrl);

    // Use <Dial> to forward the call and record it
    // record="record-from-answer" starts recording when the business number answers
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial 
    record="record-from-answer"
    recordingStatusCallback="${recordingCompleteUrl}"
    recordingStatusCallbackMethod="POST"
    action="${protocol}://${host}/dial-complete?CallSid=${encodeURIComponent(callSid || '')}"
    timeout="30"
    callerId="${callerNumber}">
    <Number>${businessPhoneNumber}</Number>
  </Dial>
</Response>`;

    console.log("Sending TwiML response with Dial");
    res.type("text/xml");
    res.status(200).send(twiml);
  } catch (error) {
    console.error("Error in /voice endpoint:", error);
    console.error("Error stack:", error.stack);
    // Return a simple TwiML response even on error
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>An error occurred processing your call.</Say>
  <Hangup/>
</Response>`;
    res.type("text/xml");
    res.status(200).send(errorTwiml);
  }
});

/**
 * Optional endpoint to handle dial completion status
 * Logs call forwarding status for monitoring
 */
app.post("/dial-complete", (req, res) => {
  console.log("=== Dial complete webhook received ===");
  console.log("Dial status:", req.body.DialCallStatus);
  console.log("Dial call duration:", req.body.DialCallDuration);
  console.log("CallSid:", req.body.CallSid);
  res.status(200).send("OK");
});

/**
 * 2️⃣ Endpoint Twilio calls AFTER the recording finishes
 * Twilio sends RecordingUrl here. We download, transcribe, and analyze it.
 */
app.post("/recording-complete", async (req, res) => {
  console.log("Full request body from Twilio:", JSON.stringify(req.body, null, 2));
  console.log("Query parameters:", JSON.stringify(req.query, null, 2));

  const recordingUrl = req.body.RecordingUrl;
  
  console.log("Step 1: Received request to /recording-complete");
  console.log("Step 2: Recording URL is:", recordingUrl);
  
  // Get CallSid - try multiple sources
  let callSid = req.query.CallSid || req.body.CallSid || null;
  
  // If we don't have CallSid, fetch it from Twilio API using the RecordingSid
  if (!callSid && recordingUrl) {
    try {
      // Extract RecordingSid from URL: https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Recordings/{RecordingSid}
      const recordingSidMatch = recordingUrl.match(/Recordings\/([^\/\?]+)/);
      if (recordingSidMatch) {
        const recordingSid = recordingSidMatch[1];
        console.log(`Step 2.1: Fetching recording details for RecordingSid: ${recordingSid}`);
        
        // Fetch recording details from Twilio API
        const recordingApiUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.json`;
        const recordingResponse = await axios.get(recordingApiUrl, {
          auth: {
            username: process.env.TWILIO_ACCOUNT_SID,
            password: process.env.TWILIO_AUTH_TOKEN,
          },
        });
        
        callSid = recordingResponse.data.call_sid;
        console.log(`✓ Retrieved CallSid ${callSid} from Twilio API`);
      } else {
        console.warn("Could not extract RecordingSid from URL:", recordingUrl);
      }
    } catch (apiErr) {
      console.error("Error fetching CallSid from Twilio API:", apiErr.message);
      if (apiErr.response) {
        console.error("API Response:", apiErr.response.status, apiErr.response.data);
      }
    }
  }
  
  // Helper function to lookup caller name using Twilio Lookup API v2
  const lookupCallerName = async (phoneNumber) => {
    if (!phoneNumber || phoneNumber === "Unknown") {
      return null;
    }
    
    try {
      // Use Twilio Lookup API v2 to get caller name
      const lookupUrl = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phoneNumber)}`;
      const lookupResponse = await axios.get(lookupUrl, {
        params: {
          Fields: 'caller_name' // Request caller name information
        },
        auth: {
          username: process.env.TWILIO_ACCOUNT_SID,
          password: process.env.TWILIO_AUTH_TOKEN,
        },
      });
      
      // The caller name is in caller_name.caller_name field
      const name = lookupResponse.data?.caller_name?.caller_name || null;
      if (name) {
        console.log(`✓ Retrieved caller name "${name}" from Lookup API for ${phoneNumber}`);
      }
      return name;
    } catch (lookupErr) {
      // Lookup API may not have data for all numbers, this is expected
      if (lookupErr.response?.status === 404) {
        console.log(`ℹ No caller name found in Lookup API for ${phoneNumber}`);
      } else {
        console.warn(`⚠ Error looking up caller name for ${phoneNumber}:`, lookupErr.message);
        if (lookupErr.response) {
          console.warn(`  Response status: ${lookupErr.response.status}, data:`, lookupErr.response.data);
        }
      }
      return null;
    }
  };
  
  // Fetch caller number and caller name - prioritize Twilio API, then memory, then fallback
  let callerNumber = "Unknown";
  let callerName = null;
  
  if (callSid) {
    // First try memory (fastest)
    if (callData.has(callSid)) {
      const storedData = callData.get(callSid);
      callerNumber = storedData.callerNumber;
      callerName = storedData.callerName || null;
      
      // If we have number but no name, try lookup
      if (callerNumber !== "Unknown" && !callerName) {
        console.log(`Step 2.2.1: Looking up caller name for ${callerNumber}`);
        callerName = await lookupCallerName(callerNumber);
        // Update stored data with name if found
        if (callerName) {
          callData.set(callSid, { ...storedData, callerName });
        }
      }
      
      console.log(`✓ Found caller number ${callerNumber}${callerName ? `, caller name: ${callerName}` : ''} in memory for CallSid ${callSid}`);
    } else {
      // Fetch from Twilio API
      try {
        console.log(`Step 2.2: Fetching call details for CallSid: ${callSid}`);
        const callApiUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`;
        const callResponse = await axios.get(callApiUrl, {
          auth: {
            username: process.env.TWILIO_ACCOUNT_SID,
            password: process.env.TWILIO_AUTH_TOKEN,
          },
        });
        
        callerNumber = callResponse.data.from || callResponse.data.caller || "Unknown";
        callerName = callResponse.data.caller_name || null;
        
        // If we have number but no name from call API, try lookup
        if (callerNumber !== "Unknown" && !callerName) {
          console.log(`Step 2.2.1: Looking up caller name for ${callerNumber}`);
          callerName = await lookupCallerName(callerNumber);
        }
        
        console.log(`✓ Retrieved caller number ${callerNumber}${callerName ? `, caller name: ${callerName}` : ''} from Twilio API`);
        
        // Store it in memory for next time
        if (callerNumber !== "Unknown") {
          callData.set(callSid, { callerNumber, callerName, timestamp: new Date().toISOString() });
        }
      } catch (apiErr) {
        console.error("Error fetching caller number from Twilio API:", apiErr.message);
        if (apiErr.response) {
          console.error("API Response:", apiErr.response.status, apiErr.response.data);
        }
        // Fallback: try to get from request body directly
        callerNumber = req.body.From || req.body.Caller || "Unknown";
        callerName = req.body.FromName || req.body.CallerName || null;
        
        // If we have number but no name, try lookup
        if (callerNumber !== "Unknown" && !callerName) {
          callerName = await lookupCallerName(callerNumber);
        }
      }
    }
  } else {
    // No CallSid available, try fallback
    callerNumber = req.body.From || req.body.Caller || "Unknown";
    callerName = req.body.FromName || req.body.CallerName || null;
    
    // If we have number but no name, try lookup
    if (callerNumber !== "Unknown" && !callerName) {
      callerName = await lookupCallerName(callerNumber);
    }
    
    console.log(`⚠ No CallSid available, using fallback: ${callerNumber}${callerName ? `, caller name: ${callerName}` : ''}`);
  }
  
  console.log(`Step 2.5: Final caller number determined: ${callerNumber}${callerName ? `, caller name: ${callerName}` : ''}`);

  if (!recordingUrl) {
    console.error("No RecordingUrl received in request");
    return res.status(400).send("No RecordingUrl provided by Twilio");
  }

  try {
    const urlWithExtension = `${recordingUrl}.wav`;
    console.log("Step 3: Downloading audio from:", urlWithExtension);

    // ✅ Download audio with Twilio auth
    const audioResponse = await axios.get(urlWithExtension, {
      responseType: "arraybuffer",
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN,
      },
    });

    const audioBuffer = Buffer.from(audioResponse.data);
    console.log("Step 4: Audio downloaded, size (bytes):", audioBuffer.length);

    // ✅ Write buffer to a temp file so we can send a proper file stream to OpenAI
    const tempFilePath = path.join(process.cwd(), "temp-recording.wav");
    fs.writeFileSync(tempFilePath, audioBuffer);
    console.log("Step 4.5: Temp file written at:", tempFilePath);

    console.log("Step 5: Sending audio to OpenAI Whisper...");
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: "whisper-1",
    });
    console.log("Step 6: Transcript received:", transcription.text);

    // Clean up temp file (optional but nice)
    try {
      fs.unlinkSync(tempFilePath);
      console.log("Step 6.5: Temp file deleted");
    } catch (cleanupErr) {
      console.warn("Could not delete temp file:", cleanupErr);
    }

    console.log("Step 7: Sending transcript to GPT for analysis...");

    const analysisPrompt = `
You are an AI call analyst. Using the transcript below, generate a structured report.

TRANSCRIPT:
"${transcription.text}"

IMPORTANT: Format your response EXACTLY as follows, with each section on a new line starting with the number:

1. **Full Transcript**
[Print the full transcript text exactly as provided]

2. **Summary**
[2-3 sentence summary of the conversation]

3. **Action Items**
[Bulleted list of action items, one per line starting with - or *. If an action item is urgent, include the word "urgent" or "URGENT" in that item]

4. **Sentiment**
[One word or short phrase: positive, negative, or neutral]

5. **Urgent Topics**
[List any urgent topics, or "None" if there are none]

Make sure each section starts with its number (2., 3., 4., 5.) on a new line and is clearly separated.
`;

    const analysis = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: analysisPrompt }],
    });

    const analysisText = analysis.choices[0].message.content;
    console.log("Step 8: AI Analysis result:\n", analysisText);

    // ✅ Save call report to history
    // Ensure callerNumber is always a string
    const finalCallerNumber = callerNumber || "Unknown";
    const finalCallerName = callerName || null;
    console.log(`Step 8.5: Saving report with caller number: ${finalCallerNumber}${finalCallerName ? `, caller name: ${finalCallerName}` : ''}`);
    
    const callReport = {
      id: Date.now().toString(), // Simple ID based on timestamp
      callerNumber: finalCallerNumber,
      callerName: finalCallerName,
      transcript: transcription.text,
      analysis: analysisText,
      recordingUrl: recordingUrl, // Store the recording URL for playback
      createdAt: new Date().toISOString(),
    };
    
    // Add to history array (newest first)
    callHistory.unshift(callReport);
    
    // Keep only last 1000 records to prevent file from getting too large
    if (callHistory.length > 1000) {
      callHistory = callHistory.slice(0, 1000);
    }
    
    // Save to file
    saveCallHistory();
    
    console.log("Step 8.6: Report saved. Total records:", callHistory.length);

    res.send("Recording processed. Check server logs for transcript and analysis.");
  } catch (err) {
    console.error("Step 9: Error processing recording:", err);
    res.status(500).send("Error processing recording");
  }
});

/**
 * 3️⃣ Proxy endpoint to serve audio recordings with Twilio auth
 */
app.get("/audio/:recordingId", async (req, res) => {
  try {
    // Reload history to get latest data
    loadCallHistory();
    
    // Find the call by ID
    const call = callHistory.find(c => c.id === req.params.recordingId);
    if (!call || !call.recordingUrl) {
      return res.status(404).send("Recording not found");
    }

    // Get the recording URL with .wav extension
    const urlWithExtension = `${call.recordingUrl}.wav`;
    
    // Fetch audio with Twilio auth
    const audioResponse = await axios.get(urlWithExtension, {
      responseType: "stream",
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN,
      },
    });

    // Set appropriate headers
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Disposition", `inline; filename="recording-${req.params.recordingId}.wav"`);
    
    // Stream the audio
    audioResponse.data.pipe(res);
  } catch (err) {
    console.error("Error serving audio:", err);
    res.status(500).send("Error loading audio");
  }
});

/**
 * Helper function to generate sidebar menu
 */
function generateSidebar(activePage = '') {
  const dashboardActive = activePage === 'dashboard' ? 'active' : '';
  const reportsActive = activePage === 'reports' ? 'active' : '';
  
  return `
    <div class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo">📞</div>
        <div class="sidebar-title">Call Analysis</div>
      </div>
      <nav class="sidebar-nav">
        <a href="/dashboard" class="nav-item ${dashboardActive}">
          <span class="nav-icon">📊</span>
          <span class="nav-label">Dashboard</span>
        </a>
        <a href="/report" class="nav-item ${reportsActive}">
          <span class="nav-icon">📋</span>
          <span class="nav-label">Interactions</span>
        </a>
      </nav>
    </div>
  `;
}

/**
 * Dashboard page
 */
app.get("/dashboard", (req, res) => {
  loadCallHistory();
  
  const totalCalls = callHistory.length;
  const recentCalls = callHistory.slice(0, 5);
  
  // Calculate statistics
  let positiveCount = 0;
  let negativeCount = 0;
  let neutralCount = 0;
  let urgentCount = 0;
  
  callHistory.forEach(call => {
    const parsed = parseAnalysis(call.analysis);
    const sentiment = parsed.sentiment ? parsed.sentiment.toLowerCase() : '';
    if (/positive|happy|good|great|excellent|satisfied|pleased/i.test(sentiment)) {
      positiveCount++;
    } else if (/negative|sad|bad|poor|angry|frustrated|disappointed|unhappy/i.test(sentiment)) {
      negativeCount++;
    } else {
      neutralCount++;
    }
    
    const hasUrgent = parsed.urgentTopics && 
      parsed.urgentTopics.toLowerCase().trim() !== 'none' && 
      parsed.urgentTopics.trim() !== '';
    if (hasUrgent) urgentCount++;
  });
  
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard - Call Analysis</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            background: #ffffff;
            color: #37352f;
            line-height: 1.5;
            min-height: 100vh;
            font-size: 14px;
            display: flex;
          }
          
          .sidebar {
            width: 240px;
            background: #ffffff;
            border-right: 1px solid #e9e9e7;
            height: 100vh;
            position: fixed;
            left: 0;
            top: 0;
            display: flex;
            flex-direction: column;
            z-index: 1000;
          }
          
          .sidebar-header {
            padding: 20px 16px;
            border-bottom: 1px solid #e9e9e7;
            display: flex;
            align-items: center;
            gap: 12px;
          }
          
          .sidebar-logo {
            width: 32px;
            height: 32px;
            background: #37352f;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 18px;
          }
          
          .sidebar-title {
            font-size: 16px;
            font-weight: 600;
            color: #37352f;
          }
          
          .sidebar-nav {
            padding: 8px;
            flex: 1;
          }
          
          .nav-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 12px;
            border-radius: 4px;
            text-decoration: none;
            color: #37352f;
            font-size: 14px;
            transition: background-color 0.15s ease;
            margin-bottom: 4px;
          }
          
          .nav-item:hover {
            background: #f7f6f3;
          }
          
          .nav-item.active {
            background: #f1f1ef;
            font-weight: 500;
          }
          
          .nav-icon {
            font-size: 18px;
            width: 24px;
            text-align: center;
          }
          
          .main-content {
            margin-left: 240px;
            flex: 1;
            padding: 32px;
            max-width: 1400px;
          }
          
          .page-header {
            margin-bottom: 32px;
          }
          
          .page-title {
            font-size: 28px;
            font-weight: 600;
            color: #37352f;
            margin-bottom: 8px;
          }
          
          .page-subtitle {
            color: #787774;
            font-size: 14px;
          }
          
          .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 32px;
          }
          
          .stat-card {
            background: #ffffff;
            border: 1px solid #e9e9e7;
            border-radius: 6px;
            padding: 20px;
          }
          
          .stat-label {
            font-size: 12px;
            color: #787774;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            margin-bottom: 8px;
          }
          
          .stat-value {
            font-size: 32px;
            font-weight: 600;
            color: #37352f;
          }
          
          .recent-calls {
            background: #ffffff;
            border: 1px solid #e9e9e7;
            border-radius: 6px;
            padding: 20px;
          }
          
          .section-title {
            font-size: 16px;
            font-weight: 600;
            color: #37352f;
            margin-bottom: 16px;
          }
          
          .call-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }
          
          .call-item {
            padding: 12px;
            border: 1px solid #e9e9e7;
            border-radius: 4px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          
          .call-item-info {
            flex: 1;
          }
          
          .call-item-number {
            font-weight: 500;
            color: #37352f;
            margin-bottom: 4px;
          }
          
          .call-item-date {
            font-size: 12px;
            color: #787774;
          }
          
          .call-item-link {
            color: #37352f;
            text-decoration: none;
            font-size: 12px;
            padding: 6px 12px;
            border: 1px solid #e9e9e7;
            border-radius: 4px;
            transition: background-color 0.15s ease;
          }
          
          .call-item-link:hover {
            background: #f7f6f3;
          }
          
          @media (max-width: 768px) {
            .sidebar {
              width: 200px;
            }
            
            .main-content {
              margin-left: 200px;
              padding: 20px;
            }
          }
        </style>
      </head>
      <body>
        ${generateSidebar('dashboard')}
        <div class="main-content">
          <div class="page-header">
            <h1 class="page-title">Dashboard</h1>
            <p class="page-subtitle">Overview of your call analytics</p>
          </div>
          
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-label">Total Calls</div>
              <div class="stat-value">${totalCalls}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Positive Sentiment</div>
              <div class="stat-value">${positiveCount}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Negative Sentiment</div>
              <div class="stat-value">${negativeCount}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Urgent Topics</div>
              <div class="stat-value">${urgentCount}</div>
            </div>
          </div>
          
          <div class="recent-calls">
            <h2 class="section-title">Recent Calls</h2>
            <div class="call-list">
              ${recentCalls.length > 0 ? recentCalls.map(call => {
                const callerNumber = call.callerNumber || "Not available";
                const callerName = call.callerName || null;
                const displayCaller = callerName ? `${callerName} (${callerNumber})` : callerNumber;
                const formatDate = new Date(call.createdAt).toLocaleString('en-US', { 
                  month: 'short', 
                  day: 'numeric', 
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit'
                });
                return `
                  <div class="call-item">
                    <div class="call-item-info">
                      <div class="call-item-number">${displayCaller.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                      <div class="call-item-date">${formatDate}</div>
                    </div>
                    <a href="/report" class="call-item-link">View Report</a>
                  </div>
                `;
              }).join('') : '<p style="color: #787774;">No calls yet</p>'}
            </div>
          </div>
        </div>
      </body>
    </html>
  `);
});

// Helper function to parse analysis (needed for dashboard)
function parseAnalysis(analysisText) {
  const sections = {
    summary: '',
    actionItems: '',
    sentiment: '',
    urgentTopics: ''
  };
  
  if (!analysisText) return sections;
  
  const lines = analysisText.split('\n');
  let currentSection = null;
  let currentContent = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (/^2\.\s*\*\*?Summary\*\*?/i.test(line) || /^2\.\s*Summary/i.test(line)) {
      if (currentSection && currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = 'summary';
      currentContent = [];
      continue;
    }
    
    if (/^3\.\s*\*\*?Action\s+Items\*\*?/i.test(line) || /^3\.\s*Action\s+Items/i.test(line)) {
      if (currentSection && currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = 'actionItems';
      currentContent = [];
      continue;
    }
    
    if (/^4\.\s*\*\*?Sentiment\*\*?/i.test(line) || /^4\.\s*Sentiment/i.test(line)) {
      if (currentSection && currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = 'sentiment';
      currentContent = [];
      continue;
    }
    
    if (/^5\.\s*\*\*?Urgent\s+Topics\*\*?/i.test(line) || /^5\.\s*Urgent\s+Topics/i.test(line)) {
      if (currentSection && currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = 'urgentTopics';
      currentContent = [];
      continue;
    }
    
    if (currentSection && line && !/^\d+\./.test(line)) {
      const cleanLine = line.replace(/\*\*/g, '').replace(/^[-*•]\s*/, '').trim();
      if (cleanLine) {
        currentContent.push(cleanLine);
      }
    }
  }
  
  if (currentSection && currentContent.length > 0) {
    sections[currentSection] = currentContent.join('\n').trim();
  }
  
  Object.keys(sections).forEach(key => {
    sections[key] = sections[key]
      .replace(/\*\*/g, '')
      .replace(/^[-*•]\s*/gm, '')
      .trim();
  });
  
  return sections;
}

/**
 * 4️⃣ Simple webpage to show the latest call report
 */
app.get("/report", (req, res) => {
  // Reload history in case it was updated
  loadCallHistory();
  
  if (callHistory.length === 0) {
    return res.send(`
      <html>
        <body style="font-family: sans-serif; max-width: 800px; margin: 40px auto;">
          <h1>Interactions</h1>
          <p>No calls analyzed yet. Make a call to your Twilio number first.</p>
        </body>
      </html>
    `);
  }

  // Parse analysis to extract sections - improved parsing logic
  const parseAnalysis = (analysisText) => {
    const sections = {
      summary: '',
      actionItems: '',
      sentiment: '',
      urgentTopics: ''
    };
    
    if (!analysisText) return sections;
    
    // Split by numbered sections (1., 2., 3., etc.) or bold headers
    // First, try to find section boundaries more reliably
    const lines = analysisText.split('\n');
    let currentSection = null;
    let currentContent = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check for section headers - be more specific
      if (/^2\.\s*\*\*?Summary\*\*?/i.test(line) || /^2\.\s*Summary/i.test(line)) {
        // Save previous section if exists
        if (currentSection && currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = 'summary';
        currentContent = [];
        continue;
      }
      
      if (/^3\.\s*\*\*?Action\s+Items\*\*?/i.test(line) || /^3\.\s*Action\s+Items/i.test(line)) {
        if (currentSection && currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = 'actionItems';
        currentContent = [];
        continue;
      }
      
      if (/^4\.\s*\*\*?Sentiment\*\*?/i.test(line) || /^4\.\s*Sentiment/i.test(line)) {
        if (currentSection && currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = 'sentiment';
        currentContent = [];
        continue;
      }
      
      if (/^5\.\s*\*\*?Urgent\s+Topics\*\*?/i.test(line) || /^5\.\s*Urgent\s+Topics/i.test(line)) {
        if (currentSection && currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = 'urgentTopics';
        currentContent = [];
        continue;
      }
      
      // If we're in a section and this line isn't a new section header, add to content
      if (currentSection && line && !/^\d+\./.test(line)) {
        // Remove markdown formatting
        const cleanLine = line.replace(/\*\*/g, '').replace(/^[-*•]\s*/, '').trim();
        if (cleanLine) {
          currentContent.push(cleanLine);
        }
      }
    }
    
    // Save the last section
    if (currentSection && currentContent.length > 0) {
      sections[currentSection] = currentContent.join('\n').trim();
    }
    
    // Clean up sections - remove markdown and extra whitespace
    Object.keys(sections).forEach(key => {
      sections[key] = sections[key]
        .replace(/\*\*/g, '')
        .replace(/^[-*•]\s*/gm, '')
        .trim();
    });
    
    // Fallback: if still empty, try regex approach
    if (!sections.summary && !sections.actionItems && !sections.sentiment) {
      // Try regex patterns as fallback
      const summaryMatch = analysisText.match(/2\.\s*\*\*?Summary\*\*?[:\s]*\n?(.*?)(?=\n\s*3\.|$)/is);
      if (summaryMatch) {
        sections.summary = summaryMatch[1].trim().replace(/\*\*/g, '');
      }
      
      const actionItemsMatch = analysisText.match(/3\.\s*\*\*?Action\s+Items\*\*?[:\s]*\n?(.*?)(?=\n\s*4\.|$)/is);
      if (actionItemsMatch) {
        sections.actionItems = actionItemsMatch[1].trim().replace(/\*\*/g, '');
      }
      
      const sentimentMatch = analysisText.match(/4\.\s*\*\*?Sentiment\*\*?[:\s]*\n?(.*?)(?=\n\s*5\.|$)/is);
      if (sentimentMatch) {
        sections.sentiment = sentimentMatch[1].trim().replace(/\*\*/g, '');
      }
      
      const urgentMatch = analysisText.match(/5\.\s*\*\*?Urgent\s+Topics\*\*?[:\s]*\n?(.*?)$/is);
      if (urgentMatch) {
        sections.urgentTopics = urgentMatch[1].trim().replace(/\*\*/g, '');
      }
    }
    
    return sections;
  };
  
  // Format action items (simple formatting, no indicators)
  const formatActionItems = (actionItemsText) => {
    if (!actionItemsText) return 'No action items';
    
    // Split by lines to process each action item
    const lines = actionItemsText.split('\n').filter(line => line.trim());
    const formattedItems = lines.map(line => {
      const cleanLine = line.replace(/^[-*•]\s*/, '').trim();
      return `<div class="action-item">${cleanLine.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
    });
    
    return formattedItems.join('');
  };
  
  // Format sentiment with status badge
  const formatSentiment = (sentimentText) => {
    if (!sentimentText) return '<span class="status-badge status-neutral">Unknown</span>';
    
    const sentiment = sentimentText.toLowerCase().trim();
    let badgeClass = 'status-neutral';
    let badgeText = sentimentText;
    
    // Check for urgent first - should be red
    if (/urgent/i.test(sentiment)) {
      badgeClass = 'status-negative';
      badgeText = 'Urgent';
    } else if (/positive|happy|good|great|excellent|satisfied|pleased/i.test(sentiment)) {
      badgeClass = 'status-positive';
      badgeText = 'Positive';
    } else if (/negative|sad|bad|poor|angry|frustrated|disappointed|unhappy/i.test(sentiment)) {
      badgeClass = 'status-negative';
      badgeText = 'Negative';
    } else if (/neutral|normal|okay|ok|average|moderate/i.test(sentiment)) {
      badgeClass = 'status-neutral';
      badgeText = 'Neutral';
    } else {
      // Default to neutral if unclear
      badgeClass = 'status-neutral';
      badgeText = sentimentText.charAt(0).toUpperCase() + sentimentText.slice(1).toLowerCase();
    }
    
    return `<span class="status-badge ${badgeClass}">${badgeText}</span>`;
  };
  
  // Helper function to create preview text
  const createPreview = (text, maxLength = 50) => {
    if (!text) return 'No content';
    const cleanText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, ' ').trim();
    if (cleanText.length <= maxLength) return cleanText;
    return cleanText.substring(0, maxLength) + '...';
  };
  
  // Generate spreadsheet-style table rows
  const tableRows = callHistory.map((call, index) => {
    const callerNumber = call.callerNumber || "Not available";
    const callerName = call.callerName || null;
    // Format: "Name (Number)" or just "Number" if no name
    const displayCaller = callerName ? `${callerName} (${callerNumber})` : callerNumber;
    const formatDate = new Date(call.createdAt).toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
    const parsed = parseAnalysis(call.analysis);
    const rowId = `row-${index}`;
    
    // Check if urgent topics actually exist (not "None" or empty)
    const hasUrgentTopics = parsed.urgentTopics && 
      parsed.urgentTopics.toLowerCase().trim() !== 'none' && 
      parsed.urgentTopics.trim() !== '';
    
    // Create previews for table cells
    const summaryPreview = createPreview(parsed.summary || 'No summary', 80);
    const actionItemsPreview = createPreview(parsed.actionItems || 'None', 60);
    const urgentTopicsPreview = createPreview(hasUrgentTopics ? parsed.urgentTopics : 'None', 50);
    
    return `
      <tr class="data-row" data-row-id="${rowId}" onclick="toggleRow('${rowId}')" style="cursor: pointer;">
        <td class="cell-expand">
          <button class="expand-row-btn" onclick="event.stopPropagation(); toggleRow('${rowId}')" aria-label="Expand row">
            <svg class="expand-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 4l4 4-4 4"/>
            </svg>
          </button>
        </td>
        <td class="cell-caller">
          <div class="cell-content">${displayCaller.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        </td>
        <td class="cell-date">
          <div class="cell-content">${formatDate}</div>
        </td>
        <td class="cell-summary">
          <div class="cell-content">${summaryPreview.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        </td>
        <td class="cell-sentiment">
          <div class="cell-content">${formatSentiment(parsed.sentiment)}</div>
        </td>
        <td class="cell-actions">
          <div class="cell-content">${actionItemsPreview.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        </td>
        <td class="cell-urgent">
          <div class="cell-content">${urgentTopicsPreview.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        </td>
        <td class="cell-audio">
          <div class="cell-content">
            ${call.recordingUrl ? `
              <button class="audio-play-btn" onclick="event.stopPropagation(); toggleAudio('${call.id}')" aria-label="Play audio">
                <svg class="play-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                <svg class="pause-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="display: none;">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                </svg>
              </button>
              <audio id="audio-${call.id}" preload="none" onended="resetAudioButton('${call.id}')">
                <source src="/audio/${call.id}" type="audio/wav">
              </audio>
            ` : '<span class="no-audio">—</span>'}
          </div>
        </td>
      </tr>
      <tr class="expanded-row" data-expanded-for="${rowId}" style="display: none;">
        <td colspan="8" class="expanded-content-cell">
          <div class="expanded-details">
            <div class="detail-section">
              <div class="detail-label">Summary</div>
              <div class="detail-value">${parsed.summary ? parsed.summary.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') : 'No summary available'}</div>
            </div>
            ${parsed.actionItems ? `
            <div class="detail-section">
              <div class="detail-label">Action Items</div>
              <div class="detail-value">${formatActionItems(parsed.actionItems)}</div>
            </div>
            ` : ''}
            ${parsed.urgentTopics ? `
            <div class="detail-section ${hasUrgentTopics ? 'urgent-detail' : ''}">
              <div class="detail-label">Urgent Topics</div>
              <div class="detail-value ${hasUrgentTopics ? 'urgent-text' : ''}">${parsed.urgentTopics.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>
            </div>
            ` : ''}
            ${call.recordingUrl ? `
            <div class="detail-section">
              <div class="detail-label">Audio Recording</div>
              <div class="detail-value">
                <button class="audio-play-btn detail-audio-btn" onclick="toggleAudio('${call.id}-detail')" aria-label="Play audio">
                  <svg class="play-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  <svg class="pause-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="display: none;">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                  </svg>
                </button>
                <audio id="audio-${call.id}-detail" preload="none" onended="resetAudioButton('${call.id}-detail')">
                  <source src="/audio/${call.id}" type="audio/wav">
                </audio>
              </div>
            </div>
            ` : ''}
            <div class="detail-section transcript-section">
              <div class="detail-label">Full Transcript</div>
              <div class="detail-value transcript-text">${call.transcript.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Interactions</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            background: #ffffff;
            color: #37352f;
            line-height: 1.5;
            min-height: 100vh;
            font-size: 14px;
            display: flex;
          }
          
          .sidebar {
            width: 240px;
            background: #ffffff;
            border-right: 1px solid #e9e9e7;
            height: 100vh;
            position: fixed;
            left: 0;
            top: 0;
            display: flex;
            flex-direction: column;
            z-index: 1000;
          }
          
          .sidebar-header {
            padding: 20px 16px;
            border-bottom: 1px solid #e9e9e7;
            display: flex;
            align-items: center;
            gap: 12px;
          }
          
          .sidebar-logo {
            width: 32px;
            height: 32px;
            background: #37352f;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 18px;
          }
          
          .sidebar-title {
            font-size: 16px;
            font-weight: 600;
            color: #37352f;
          }
          
          .sidebar-nav {
            padding: 8px;
            flex: 1;
          }
          
          .nav-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 12px;
            border-radius: 4px;
            text-decoration: none;
            color: #37352f;
            font-size: 14px;
            transition: background-color 0.15s ease;
            margin-bottom: 4px;
          }
          
          .nav-item:hover {
            background: #f7f6f3;
          }
          
          .nav-item.active {
            background: #f1f1ef;
            font-weight: 500;
          }
          
          .nav-icon {
            font-size: 18px;
            width: 24px;
            text-align: center;
          }
          
          .main-content {
            margin-left: 240px;
            flex: 1;
            width: calc(100% - 240px);
          }
          
          .app-container {
            width: 100%;
            padding: 0;
          }
          
          .header {
            background: #ffffff;
            border-bottom: 1px solid #e9e9e7;
            padding: 20px 24px;
            position: sticky;
            top: 0;
            z-index: 100;
            backdrop-filter: blur(10px);
            background: rgba(255, 255, 255, 0.95);
          }
          
          .header-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
            flex-wrap: wrap;
            gap: 16px;
          }
          
          .logo-section {
            display: flex;
            align-items: center;
            gap: 12px;
          }
          
          .logo-icon {
            width: 36px;
            height: 36px;
            background: #37352f;
            border-radius: 5px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 20px;
            font-weight: 500;
          }
          
          .header-title {
            font-size: 22px;
            font-weight: 600;
            color: #37352f;
            letter-spacing: -0.4px;
          }
          
          .result-count {
            color: #787774;
            font-size: 13px;
            font-weight: 400;
            margin-left: 10px;
          }
          
          .search-wrapper {
            position: relative;
            max-width: 420px;
            width: 100%;
          }
          
          .column-headers {
            display: flex;
            align-items: center;
            padding: 12px 0 0 0;
            border-top: 1px solid #e9e9e7;
            margin-top: 16px;
            background: #ffffff;
          }
          
          .header-cell {
            padding: 10px 16px;
            font-weight: 600;
            font-size: 11px;
            color: #787774;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            white-space: nowrap;
            flex-shrink: 0;
            text-align: left;
            line-height: 1.4;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          }
          
          .header-cell.cell-expand {
            width: 48px;
            padding: 10px 12px;
            flex-shrink: 0;
            text-align: center;
          }
          
          .header-cell.cell-caller,
          .header-cell.cell-date,
          .header-cell.cell-summary,
          .header-cell.cell-sentiment,
          .header-cell.cell-actions,
          .header-cell.cell-urgent,
          .header-cell.cell-audio {
            font-weight: 600;
            font-size: 11px;
            color: #787774;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            text-align: left;
            line-height: 1.4;
          }
          
          .header-cell.cell-caller {
            width: 240px;
            min-width: 240px;
            max-width: 240px;
          }
          
          .header-cell.cell-date {
            width: 180px;
            min-width: 180px;
            max-width: 180px;
          }
          
          .header-cell.cell-summary {
            min-width: 280px;
            max-width: 400px;
            flex: 1;
          }
          
          .header-cell.cell-sentiment {
            width: 110px;
            min-width: 110px;
            max-width: 110px;
          }
          
          .header-cell.cell-actions {
            min-width: 220px;
            max-width: 320px;
            flex: 1;
          }
          
          .header-cell.cell-urgent {
            min-width: 180px;
            max-width: 280px;
            flex: 1;
          }
          
          .header-cell.cell-audio {
            width: 140px;
            min-width: 140px;
            max-width: 140px;
          }
          
          .search-container {
            display: flex;
            align-items: center;
            background: #f7f6f3;
            border: 1px solid #e9e9e7;
            border-radius: 4px;
            padding: 0 12px;
            height: 32px;
            transition: all 0.2s ease;
          }
          
          .search-container:hover {
            background: #f1f1ef;
          }
          
          .search-container.focused {
            background: #ffffff;
            border-color: #37352f;
            box-shadow: 0 0 0 2px rgba(55, 53, 47, 0.1);
          }
          
          .search-icon {
            width: 16px;
            height: 16px;
            color: #787774;
            margin-right: 8px;
            flex-shrink: 0;
          }
          
          .search-input {
            flex: 1;
            border: none;
            outline: none;
            font-size: 14px;
            font-family: 'Inter', sans-serif;
            color: #37352f;
            background: transparent;
          }
          
          .search-input::placeholder {
            color: #9b9a97;
          }
          
          .clear-button {
            display: none;
            width: 16px;
            height: 16px;
            border: none;
            background: none;
            cursor: pointer;
            padding: 0;
            margin-left: 8px;
            color: #787774;
            flex-shrink: 0;
          }
          
          .clear-button.visible {
            display: block;
          }
          
          .clear-icon {
            width: 100%;
            height: 100%;
          }
          
          .table-wrapper {
            overflow-x: auto;
            width: 100%;
            background: #ffffff;
            margin-top: 0;
          }
          
          .header .column-headers {
            overflow-x: auto;
            margin-left: 0;
            margin-right: 0;
          }
          
          .header .column-headers::-webkit-scrollbar,
          .table-wrapper::-webkit-scrollbar {
            height: 8px;
          }
          
          .header .column-headers::-webkit-scrollbar-track,
          .table-wrapper::-webkit-scrollbar-track {
            background: #f7f6f3;
          }
          
          .header .column-headers::-webkit-scrollbar-thumb,
          .table-wrapper::-webkit-scrollbar-thumb {
            background: #d1d1cf;
            border-radius: 4px;
          }
          
          .header .column-headers::-webkit-scrollbar-thumb:hover,
          .table-wrapper::-webkit-scrollbar-thumb:hover {
            background: #9b9a97;
          }
          
          .data-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            background: #ffffff;
          }
          
          .data-table td {
            padding: 14px 16px;
            border-bottom: 1px solid #f1f1ef;
            vertical-align: middle;
            background: #ffffff;
          }
          
          .data-table tbody tr {
            transition: background-color 0.15s ease;
          }
          
          .data-table tbody tr:hover {
            background: #f7f6f3;
          }
          
          .data-table tbody tr:hover td {
            background: #f7f6f3;
          }
          
          .data-table tbody tr.expanded-row {
            background: #fafafa;
          }
          
          .data-table tbody tr.expanded-row td {
            border-bottom: 1px solid #e9e9e7;
            background: #fafafa;
          }
          
          .cell-expand {
            width: 48px;
            padding: 14px 12px !important;
            text-align: center;
          }
          
          .expand-row-btn {
            background: none;
            border: none;
            cursor: pointer;
            padding: 6px;
            border-radius: 4px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: #9b9a97;
            transition: all 0.15s ease;
            width: 28px;
            height: 28px;
          }
          
          .expand-row-btn:hover {
            background: none;
            color: #37352f;
          }
          
          .data-row.expanded .expand-icon {
            transform: rotate(90deg);
          }
          
          .expand-icon {
            transition: transform 0.2s ease;
            width: 14px;
            height: 14px;
          }
          
          .cell-content {
            color: #37352f;
            font-size: 14px;
            line-height: 1.5;
            word-wrap: break-word;
            overflow: hidden;
            text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
          }
          
          .cell-caller {
            width: 240px;
            min-width: 240px;
            max-width: 300px;
          }
          
          .cell-caller .cell-content {
            -webkit-line-clamp: 2;
            font-weight: normal;
            color: #37352f;
            font-size: 14px;
          }
          
          .cell-date {
            width: 180px;
            min-width: 180px;
            max-width: 200px;
            color: #787774;
            font-size: 13px;
          }
          
          .cell-date .cell-content {
            -webkit-line-clamp: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            display: block;
          }
          
          .cell-summary {
            min-width: 280px;
            max-width: 400px;
          }
          
          .cell-sentiment {
            width: 110px;
            min-width: 110px;
            max-width: 130px;
          }
          
          .cell-sentiment .cell-content {
            display: block;
            -webkit-line-clamp: 1;
          }
          
          .cell-actions {
            min-width: 220px;
            max-width: 320px;
          }
          
          .cell-urgent {
            min-width: 180px;
            max-width: 280px;
          }
          
          .cell-audio {
            width: 140px;
            min-width: 140px;
            max-width: 180px;
          }
          
          .cell-audio .cell-content {
            display: flex;
            align-items: center;
            -webkit-line-clamp: 1;
          }
          
          .audio-play-btn {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            border: 1px solid #e9e9e7;
            background: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.15s ease;
            padding: 0;
            outline: none;
            color: #37352f;
          }
          
          .audio-play-btn:hover {
            background: #f7f6f3;
            border-color: #d1d1cf;
          }
          
          .audio-play-btn:active {
            transform: scale(0.95);
          }
          
          .audio-play-btn.playing {
            background: #f1f1ef;
            border-color: #37352f;
          }
          
          .audio-play-btn svg {
            width: 14px;
            height: 14px;
          }
          
          .detail-audio-btn {
            width: 40px;
            height: 40px;
          }
          
          .detail-audio-btn svg {
            width: 18px;
            height: 18px;
          }
          
          .no-audio {
            color: #9b9a97;
            font-size: 12px;
            font-style: italic;
          }
          
          .expanded-content-cell {
            padding: 20px 24px !important;
            background: #fafafa;
            border-bottom: 1px solid #e9e9e7 !important;
          }
          
          .expanded-details {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 16px;
            max-width: 1200px;
          }
          
          .detail-section {
            background: #ffffff;
            border: 1px solid #e9e9e7;
            border-radius: 6px;
            padding: 16px 20px;
          }
          
          .detail-section.transcript-section {
            grid-column: 3;
            grid-row: 1 / -1;
          }
          
          .detail-section.urgent-detail {
            border-left: 4px solid #e16259;
            background: #fff5f3;
          }
          
          .detail-label {
            font-size: 11px;
            font-weight: 600;
            color: #787774;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            margin-bottom: 10px;
            display: block;
          }
          
          .detail-value {
            font-size: 14px;
            color: #37352f;
            line-height: 1.65;
          }
          
          .urgent-text {
            color: #e16259;
            font-weight: 500;
          }
          
          .transcript-text {
            max-height: 350px;
            overflow-y: auto;
            font-size: 14px;
            color: #37352f;
            line-height: 1.65;
            white-space: pre-wrap;
            word-wrap: break-word;
          }
          
          
          .status-badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 12px;
            font-weight: 400;
            letter-spacing: 0;
            white-space: nowrap;
            line-height: 1.4;
            border: none;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          }
          
          .status-positive {
            background-color: rgba(46, 170, 220, 0.12);
            color: #0b6e99;
          }
          
          .status-negative {
            background-color: rgba(235, 87, 87, 0.12);
            color: #d1242f;
          }
          
          .status-neutral {
            background-color: rgba(55, 53, 47, 0.09);
            color: #37352f;
          }
          
          .action-item {
            padding: 10px 0;
            border-bottom: 1px solid #f1f1ef;
            line-height: 1.6;
            display: flex;
            align-items: flex-start;
          }
          
          .action-item:last-child {
            border-bottom: none;
            padding-bottom: 0;
          }
          
          .action-item:first-child {
            padding-top: 0;
          }
          
          .action-item::before {
            content: "→";
            color: #787774;
            font-weight: normal;
            margin-right: 10px;
            font-size: 14px;
            flex-shrink: 0;
            margin-top: 2px;
          }
          
          .empty-state {
            text-align: center;
            padding: 100px 24px;
            background: #ffffff;
          }
          
          .empty-state-icon {
            font-size: 56px;
            margin-bottom: 20px;
            opacity: 0.3;
          }
          
          .empty-state-text {
            font-size: 15px;
            color: #787774;
            line-height: 1.6;
          }
          
          .row-hidden {
            display: none !important;
          }
          
          @media (max-width: 768px) {
            .header {
              padding: 16px 20px;
            }
            
            .header-title {
              font-size: 20px;
            }
            
            .column-headers {
              padding: 10px 0 0 0;
              margin-top: 12px;
            }
            
            .header-cell {
              padding: 8px 12px;
              font-size: 10px;
            }
            
            .header-cell.cell-expand {
              width: 44px;
              padding: 8px 8px;
            }
            
            .header-cell.cell-caller,
            .header-cell.cell-date,
            .header-cell.cell-summary,
            .header-cell.cell-actions,
            .header-cell.cell-urgent {
              min-width: 150px;
              max-width: 200px;
            }
            
            .data-table td {
              padding: 12px;
              font-size: 13px;
            }
            
            .cell-expand {
              width: 44px;
              padding: 12px 8px !important;
            }
            
            .cell-caller,
            .cell-date,
            .cell-summary,
            .cell-actions,
            .cell-urgent {
              min-width: 150px;
              max-width: 200px;
            }
            
            .expanded-content-cell {
              padding: 16px !important;
            }
            
            .expanded-details {
              grid-template-columns: 1fr;
            }
            
            .sidebar {
              width: 200px;
            }
            
            .main-content {
              margin-left: 200px;
              width: calc(100% - 200px);
            }
          }
        </style>
        <script>
          function toggleRow(rowId) {
            const row = document.querySelector('[data-row-id="' + rowId + '"]');
            const expandedRow = document.querySelector('[data-expanded-for="' + rowId + '"]');
            
            if (row && expandedRow) {
              const isExpanded = expandedRow.style.display !== 'none';
              
              if (isExpanded) {
                expandedRow.style.display = 'none';
                row.classList.remove('expanded');
              } else {
                expandedRow.style.display = '';
                row.classList.add('expanded');
              }
            }
          }
          
          function filterRows() {
            const input = document.getElementById('searchInput');
            if (!input) return;
            
            const filter = input.value.toLowerCase().trim();
            const rows = document.querySelectorAll('.data-row');
            let visibleCount = 0;
            
            rows.forEach(function(row) {
              const rowText = row.textContent || row.innerText || '';
              const rowTextLower = rowText.toLowerCase();
              const rowId = row.getAttribute('data-row-id');
              const expandedRow = document.querySelector('[data-expanded-for="' + rowId + '"]');
              
              if (!filter || rowTextLower.includes(filter)) {
                row.classList.remove('row-hidden');
                if (expandedRow) {
                  expandedRow.classList.remove('row-hidden');
                }
                visibleCount++;
              } else {
                row.classList.add('row-hidden');
                if (expandedRow) {
                  expandedRow.classList.add('row-hidden');
                }
              }
            });
            
            const resultCount = document.getElementById('resultCount');
            if (resultCount) {
              resultCount.textContent = visibleCount + ' calls';
            }
            
            const clearButton = document.getElementById('clearButton');
            if (clearButton) {
              if (filter) {
                clearButton.classList.add('visible');
              } else {
                clearButton.classList.remove('visible');
              }
            }
          }
          
          function clearSearch() {
            const input = document.getElementById('searchInput');
            if (input) {
              input.value = '';
              filterRows();
              input.focus();
            }
          }
          
          function toggleAudio(audioId) {
            const audio = document.getElementById('audio-' + audioId);
            if (!audio) return;
            
            // Find the button - it's the previous sibling or in the same parent
            let btn = audio.previousElementSibling;
            if (!btn || !btn.classList.contains('audio-play-btn')) {
              btn = audio.parentElement.querySelector('.audio-play-btn');
            }
            
            if (!btn) return;
            
            // Pause all other audio players
            document.querySelectorAll('audio').forEach(a => {
              if (a !== audio && !a.paused) {
                a.pause();
                a.currentTime = 0;
                let otherBtn = a.previousElementSibling;
                if (!otherBtn || !otherBtn.classList.contains('audio-play-btn')) {
                  otherBtn = a.parentElement.querySelector('.audio-play-btn');
                }
                if (otherBtn) {
                  otherBtn.classList.remove('playing');
                  const playIcon = otherBtn.querySelector('.play-icon');
                  const pauseIcon = otherBtn.querySelector('.pause-icon');
                  if (playIcon) playIcon.style.display = '';
                  if (pauseIcon) pauseIcon.style.display = 'none';
                }
              }
            });
            
            if (audio.paused) {
              audio.play();
              btn.classList.add('playing');
              const playIcon = btn.querySelector('.play-icon');
              const pauseIcon = btn.querySelector('.pause-icon');
              if (playIcon) playIcon.style.display = 'none';
              if (pauseIcon) pauseIcon.style.display = '';
            } else {
              audio.pause();
              btn.classList.remove('playing');
              const playIcon = btn.querySelector('.play-icon');
              const pauseIcon = btn.querySelector('.pause-icon');
              if (playIcon) playIcon.style.display = '';
              if (pauseIcon) pauseIcon.style.display = 'none';
            }
          }
          
          function resetAudioButton(audioId) {
            const audio = document.getElementById('audio-' + audioId);
            if (!audio) return;
            
            let btn = audio.previousElementSibling;
            if (!btn || !btn.classList.contains('audio-play-btn')) {
              btn = audio.parentElement.querySelector('.audio-play-btn');
            }
            
            if (btn) {
              btn.classList.remove('playing');
              const playIcon = btn.querySelector('.play-icon');
              const pauseIcon = btn.querySelector('.pause-icon');
              if (playIcon) playIcon.style.display = '';
              if (pauseIcon) pauseIcon.style.display = 'none';
            }
          }
          
          document.addEventListener('DOMContentLoaded', function() {
            const searchInput = document.getElementById('searchInput');
            const searchContainer = document.querySelector('.search-container');
            
            if (searchInput) {
              searchInput.addEventListener('focus', function() {
                searchContainer.classList.add('focused');
              });
              
              searchInput.addEventListener('blur', function() {
                searchContainer.classList.remove('focused');
              });
              
              searchInput.addEventListener('input', filterRows);
            }
            
            // Sync horizontal scrolling between column headers and table
            const columnHeaders = document.querySelector('.column-headers');
            const tableWrapper = document.querySelector('.table-wrapper');
            
            if (columnHeaders && tableWrapper) {
              tableWrapper.addEventListener('scroll', function() {
                columnHeaders.scrollLeft = tableWrapper.scrollLeft;
              });
              
              columnHeaders.addEventListener('scroll', function() {
                tableWrapper.scrollLeft = columnHeaders.scrollLeft;
              });
            }
          });
        </script>
      </head>
      <body>
        ${generateSidebar('reports')}
        <div class="main-content">
          <div class="app-container">
          <div class="header">
            <div class="header-top">
              <div class="logo-section">
                <div class="logo-icon">📞</div>
                <h1 class="header-title">
                  Interactions
                  <span class="result-count" id="resultCount">${callHistory.length} calls</span>
                </h1>
              </div>
            </div>
            <div class="search-wrapper">
              <div class="search-container">
                <svg class="search-icon" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                  <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <input 
                  type="text" 
                  class="search-input" 
                  id="searchInput" 
                  placeholder="Search calls..." 
                  autocomplete="off"
                />
                <button class="clear-button" id="clearButton" onclick="clearSearch()" aria-label="Clear search">
                  <svg class="clear-icon" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              </div>
            </div>
            ${callHistory.length > 0 ? `
            <div class="column-headers">
              <div class="header-cell cell-expand"></div>
              <div class="header-cell cell-caller">Caller</div>
              <div class="header-cell cell-date">Date &amp; Time</div>
              <div class="header-cell cell-summary">Summary</div>
              <div class="header-cell cell-sentiment">Sentiment</div>
              <div class="header-cell cell-actions">Action Items</div>
              <div class="header-cell cell-urgent">Urgent Topics</div>
              <div class="header-cell cell-audio">Listen</div>
            </div>
            ` : ''}
          </div>
          <div class="table-wrapper">
            ${callHistory.length > 0 ? `
              <table class="data-table">
                <tbody>
                  ${tableRows}
                </tbody>
              </table>
            ` : `
              <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <div class="empty-state-text">No calls analyzed yet. Make a call to your Twilio number first.</div>
              </div>
            `}
          </div>
        </div>
        </div>
      </body>
    </html>
  `);
});

// Root endpoint redirects to dashboard
app.get("/", (req, res) => {
  res.redirect("/dashboard");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
