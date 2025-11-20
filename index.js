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
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json()); // parse JSON from Twilio

const port = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * 1️⃣ Endpoint to handle incoming calls
 * Twilio hits this when someone calls your number.
 * We respond with TwiML that RECORDS the call.
 */
app.post("/voice", (req, res) => {
  const host = req.headers["host"]; // e.g. abcd1234.ngrok-free.dev

  // Capture caller number and CallSid from the initial call
  const callerNumber = req.body.From || req.body.Caller || "Unknown";
  const callSid = req.body.CallSid;
  
  console.log("Voice webhook received. Full body:", JSON.stringify(req.body, null, 2));
  
  // Store caller info for later lookup
  if (callSid) {
    callData.set(callSid, { callerNumber, timestamp: new Date().toISOString() });
    console.log(`✓ Stored caller number ${callerNumber} for CallSid ${callSid}`);
  } else {
    console.log("⚠ No CallSid in voice webhook");
  }
  
  // Pass CallSid as query parameter so we can retrieve it when recording completes
  const recordingCompleteUrl = callSid 
    ? `https://${host}/recording-complete?CallSid=${encodeURIComponent(callSid)}`
    : `https://${host}/recording-complete`;
  
  console.log("Using recordingCompleteUrl:", recordingCompleteUrl);

  const twiml = `
    <Response>
      <Record action="${recordingCompleteUrl}" maxLength="3600" />
      <Hangup/>
    </Response>
  `;

  res.type("text/xml");
  res.send(twiml);
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
  
  // Fetch caller number - prioritize Twilio API, then memory, then fallback
  let callerNumber = "Unknown";
  
  if (callSid) {
    // First try memory (fastest)
    if (callData.has(callSid)) {
      callerNumber = callData.get(callSid).callerNumber;
      console.log(`✓ Found caller number ${callerNumber} in memory for CallSid ${callSid}`);
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
        console.log(`✓ Retrieved caller number ${callerNumber} from Twilio API`);
        
        // Store it in memory for next time
        if (callerNumber !== "Unknown") {
          callData.set(callSid, { callerNumber, timestamp: new Date().toISOString() });
        }
      } catch (apiErr) {
        console.error("Error fetching caller number from Twilio API:", apiErr.message);
        if (apiErr.response) {
          console.error("API Response:", apiErr.response.status, apiErr.response.data);
        }
        // Fallback: try to get from request body directly
        callerNumber = req.body.From || req.body.Caller || "Unknown";
      }
    }
  } else {
    // No CallSid available, try fallback
    callerNumber = req.body.From || req.body.Caller || "Unknown";
    console.log(`⚠ No CallSid available, using fallback: ${callerNumber}`);
  }
  
  console.log(`Step 2.5: Final caller number determined: ${callerNumber}`);

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
    console.log(`Step 8.5: Saving report with caller number: ${finalCallerNumber}`);
    
    const callReport = {
      id: Date.now().toString(), // Simple ID based on timestamp
      callerNumber: finalCallerNumber,
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
 * 4️⃣ Simple webpage to show the latest call report
 */
app.get("/report", (req, res) => {
  // Reload history in case it was updated
  loadCallHistory();
  
  if (callHistory.length === 0) {
    return res.send(`
      <html>
        <body style="font-family: sans-serif; max-width: 800px; margin: 40px auto;">
          <h1>Call Reports</h1>
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
      badgeText = sentimentText.charAt(0).toUpperCase() + sentimentText.slice(1);
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
  
  // Generate table rows for all calls
  const tableRows = callHistory.map((call, index) => {
    const displayCallerNumber = call.callerNumber || "Not available";
    const formatDate = new Date(call.createdAt).toLocaleString();
    const parsed = parseAnalysis(call.analysis);
    const rowId = `row-${index}`;
    
    // Create previews
    const transcriptPreview = createPreview(call.transcript, 60);
    const summaryPreview = createPreview(parsed.summary, 50);
    const actionItemsPreview = createPreview(parsed.actionItems, 50);
    const urgentTopicsPreview = createPreview(parsed.urgentTopics, 40);
    
    return `
              <tr class="data-row" data-row-id="${rowId}">
                <td class="toggle-cell">
                  <button class="toggle-icon" onclick="toggleRow('${rowId}')" aria-label="Toggle row">
                    <span class="icon-plus">+</span>
                    <span class="icon-minus" style="display: none;">−</span>
                  </button>
                </td>
                <td class="caller-number">
                  <div class="preview-content">${displayCallerNumber}</div>
                  <div class="full-content" style="display: none;">${displayCallerNumber}</div>
                </td>
                <td class="timestamp">
                  <div class="preview-content">${formatDate}</div>
                  <div class="full-content" style="display: none;">${formatDate}</div>
                </td>
                <td class="content-cell">
                  <div class="preview-content">${transcriptPreview}</div>
                  <div class="full-content" style="display: none;">
                    <div class="full-text">${call.transcript.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                  </div>
                </td>
                <td class="content-cell">
                  <div class="preview-content">${summaryPreview}</div>
                  <div class="full-content" style="display: none;">
                    <div class="summary-text">${parsed.summary ? parsed.summary.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') : 'No summary available'}</div>
                  </div>
                </td>
                <td class="content-cell">
                  <div class="preview-content">${formatSentiment(parsed.sentiment)}</div>
                  <div class="full-content" style="display: none;">
                    <div class="sentiment-text">${formatSentiment(parsed.sentiment)}</div>
                  </div>
                </td>
                <td class="content-cell">
                  <div class="preview-content">${actionItemsPreview}</div>
                  <div class="full-content" style="display: none;">
                    <div class="summary-text">${formatActionItems(parsed.actionItems)}</div>
                  </div>
                </td>
                <td class="content-cell">
                  <div class="preview-content">${urgentTopicsPreview}</div>
                  <div class="full-content" style="display: none;">
                    <div class="summary-text">${parsed.urgentTopics ? parsed.urgentTopics.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') : 'None'}</div>
                  </div>
                </td>
                <td class="audio-cell">
                  ${call.recordingUrl ? `
                    <audio controls preload="none" style="width: 100%; max-width: 200px; height: 32px;">
                      <source src="/audio/${call.id}" type="audio/wav">
                      Your browser does not support the audio element.
                    </audio>
                  ` : '<span style="color: #999; font-size: 12px;">No recording</span>'}
                </td>
              </tr>`;
  }).join('');

  res.send(`
    <html>
      <head>
        <title>Call Reports</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            background: #f5f5f5;
            padding: 20px;
          }
          .container {
            width: 100%;
            max-width: 100%;
            margin: 0;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            overflow: hidden;
          }
          body {
            overflow-x: hidden;
          }
          h1 {
            padding: 0;
            background: transparent;
            color: white;
            font-size: 24px;
            margin: 0;
            flex: 0 0 auto;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }
          thead {
            background: #34495e;
            color: white;
          }
          th {
            padding: 12px;
            text-align: left;
            font-weight: 600;
            border-bottom: 2px solid #2c3e50;
          }
          td {
            padding: 12px;
            border-bottom: 1px solid #e0e0e0;
            vertical-align: top;
            overflow: hidden;
            word-wrap: break-word;
            overflow-wrap: break-word;
            position: relative;
          }
          /* Ensure all cells align to top consistently */
          td.caller-number,
          td.timestamp {
            vertical-align: top;
          }
          td:nth-child(8) {
            overflow: hidden !important;
          }
          .toggle-cell {
            width: 3%;
          }
          .caller-number {
            width: 9%;
          }
          .timestamp {
            width: 11%;
          }
          .audio-cell {
            width: 9%;
            text-align: center;
            vertical-align: middle;
            padding: 8px !important;
          }
          .audio-cell audio {
            width: 100%;
            max-width: 180px;
            height: 32px;
            outline: none;
          }
          .audio-cell audio::-webkit-media-controls-panel {
            background-color: #f5f5f5;
          }
          .content-cell {
            overflow: hidden;
            word-wrap: break-word;
            overflow-wrap: break-word;
            max-width: 100%;
          }
          .full-content {
            max-width: 100%;
            overflow-wrap: break-word;
            word-wrap: break-word;
          }
          .full-content .full-text {
            max-width: 100%;
            overflow-wrap: break-word;
          }
          /* Responsive column widths - percentages add up to 100% */
          td:nth-child(4),
          th:nth-child(4) {
            width: 18%;
          }
          td:nth-child(5),
          th:nth-child(5) {
            width: 18%;
          }
          td:nth-child(6),
          th:nth-child(6) {
            width: 9%;
          }
          td:nth-child(7),
          th:nth-child(7) {
            width: 12%;
          }
          td:nth-child(8),
          th:nth-child(8) {
            width: 11%;
            overflow: hidden !important;
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
            word-break: break-word !important;
          }
          td:nth-child(9),
          th:nth-child(9) {
            width: 9%;
          }
          /* Ensure urgent topics column wraps properly - apply to all children */
          td:nth-child(8) * {
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
            word-break: break-word !important;
            max-width: 100% !important;
            white-space: normal !important;
            box-sizing: border-box !important;
          }
          td:nth-child(8) .content-cell,
          td:nth-child(8) .full-content,
          td:nth-child(8) .preview-content,
          td:nth-child(8) .summary-text {
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
            word-break: break-word !important;
            max-width: 100% !important;
            white-space: normal !important;
            overflow: hidden !important;
            box-sizing: border-box !important;
          }
          tbody tr:hover {
            background: #f9f9f9;
          }
          thead tr:hover {
            background: #34495e;
          }
          .summary-text, .sentiment-text {
            min-height: 20px;
            padding: 0;
            margin: 0;
          }
          .full-text {
            background: transparent;
            padding: 0;
            border-radius: 0;
            font-size: 13px;
            line-height: 1.5;
            max-height: 200px;
            overflow-y: auto;
            margin: 0;
          }
          .summary-text, .sentiment-text {
            font-size: 13px;
            line-height: 1.5;
          }
          .timestamp {
            white-space: nowrap;
            font-size: 13px;
            line-height: 1.5;
            color: #333;
          }
          .caller-number {
            font-size: 13px;
            line-height: 1.5;
            color: #333;
          }
          .action-item {
            margin: 0;
            margin-bottom: 8px;
            line-height: 1.6;
          }
          .action-item:first-child {
            margin-top: 0;
          }
          .status-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 500;
            line-height: 1.4;
            margin-right: 6px;
            vertical-align: middle;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          }
          .status-positive {
            background-color: #D4EDDA;
            color: #155724;
            border: 1px solid #C3E6CB;
          }
          .status-negative {
            background-color: #F8D7DA;
            color: #721C24;
            border: 1px solid #F5C6CB;
          }
          .status-neutral {
            background-color: #E2E3E5;
            color: #383D41;
            border: 1px solid #D6D8DB;
          }
          .toggle-cell {
            width: 40px;
            padding: 8px 4px !important;
            text-align: center;
            vertical-align: middle;
          }
          .toggle-icon {
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 3px;
            color: #787878;
            font-size: 16px;
            font-weight: 300;
            transition: all 0.2s ease;
          }
          .toggle-icon:hover {
            background-color: #f0f0f0;
            color: #37352f;
          }
          .icon-plus, .icon-minus {
            display: inline-block;
            line-height: 1;
          }
          .preview-content,
          .full-content {
            font-size: 13px;
            line-height: 1.5;
            color: #37352f;
            margin: 0;
            padding: 0;
            display: block;
            position: relative;
            top: 0;
            left: 0;
          }
          .preview-content {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .full-content {
            overflow-wrap: break-word;
            word-wrap: break-word;
            white-space: normal;
          }
          .data-row.expanded .preview-content {
            display: none;
          }
          .data-row.expanded .full-content {
            display: block !important;
          }
          .data-row:not(.expanded) .preview-content {
            display: block;
          }
          .data-row:not(.expanded) .full-content {
            display: none !important;
          }
          /* Ensure all content starts at the same vertical position */
          td > .preview-content,
          td > .full-content {
            margin-top: 0;
            padding-top: 0;
            vertical-align: top;
          }
          /* Remove any top margin/padding from first child in full-content */
          .full-content > *:first-child {
            margin-top: 0 !important;
            padding-top: 0 !important;
          }
          /* Ensure nested divs don't add extra spacing */
          .full-content .full-text,
          .full-content .summary-text,
          .full-content .sentiment-text {
            margin-top: 0;
          }
          .data-row.expanded .icon-plus {
            display: none;
          }
          .data-row.expanded .icon-minus {
            display: inline-block !important;
          }
          .data-row:not(.expanded) .icon-plus {
            display: inline-block;
          }
          .data-row:not(.expanded) .icon-minus {
            display: none !important;
          }
          .header-container {
            padding: 20px;
            background: #2c3e50;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
          }
          .search-container {
            display: flex;
            align-items: center;
            gap: 12px;
            flex: 0 0 auto;
          }
          .search-box {
            flex: 0 0 auto;
            max-width: 250px;
            width: 250px;
            padding: 8px 12px;
            border: 1px solid #4a5568;
            border-radius: 4px;
            background: white;
            font-size: 14px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            color: #37352f;
            outline: none;
            transition: border-color 0.2s;
          }
          .search-box:focus {
            border-color: #3498db;
            box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.1);
          }
          .search-box::placeholder {
            color: #999;
          }
          .search-icon {
            color: white;
            font-size: 18px;
            margin-right: 4px;
          }
          .row-hidden {
            display: none !important;
          }
        </style>
        <script>
          function toggleRow(rowId) {
            const row = document.querySelector('tr[data-row-id="' + rowId + '"]');
            if (row) {
              row.classList.toggle('expanded');
            }
          }
          
          function filterTable() {
            const input = document.getElementById('searchInput');
            if (!input) return;
            
            const filter = input.value.toLowerCase().trim();
            const rows = document.querySelectorAll('tbody tr.data-row');
            let visibleCount = 0;
            
            rows.forEach(function(row) {
              // Get all text content from the row
              const rowText = row.textContent || row.innerText || '';
              const rowTextLower = rowText.toLowerCase();
              
              // Check if search term matches
              if (!filter || rowTextLower.includes(filter)) {
                row.classList.remove('row-hidden');
                visibleCount++;
              } else {
                row.classList.add('row-hidden');
              }
            });
            
            // Update result count
            const resultCount = document.getElementById('resultCount');
            if (resultCount) {
              resultCount.textContent = visibleCount;
            }
          }
        </script>
      </head>
      <body>
        <div class="container">
          <div class="header-container">
            <h1>Call Reports (<span id="resultCount">${callHistory.length}</span> total)</h1>
            <div class="search-container">
              <span class="search-icon">🔍</span>
              <input 
                type="text" 
                class="search-box" 
                id="searchInput" 
                placeholder="Search..." 
                onkeyup="filterTable()"
              />
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width: 3%;"></th>
                <th style="width: 9%;">Caller Number</th>
                <th style="width: 11%;">Time</th>
                <th style="width: 18%;">Full Text</th>
                <th style="width: 18%;">Summary</th>
                <th style="width: 9%;">Sentiment</th>
                <th style="width: 12%;">Action Items</th>
                <th style="width: 11%;">Urgent Topics</th>
                <th style="width: 9%;">Audio</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `);
});

// Optional: root endpoint for testing in a browser
app.get("/", (req, res) => {
  res.send("Server is running!");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
