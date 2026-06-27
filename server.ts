import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Shared Gemini SDK client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

const app = express();
const PORT = 3000;

// Enable larger payloads to handle uploading and analyzing larger file sets
app.use(express.json({ limit: '15mb' }));

// Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// POST /api/save-ticket - Save a ticket locally
app.post("/api/save-ticket", (req, res) => {
  try {
    const ticket = req.body;
    const dir = path.resolve(process.cwd(), 'saved_tickets');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Clean up the name for safe filename
    const cleanPassenger = (ticket.passenger || 'Unknown').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const cleanRes = (ticket.resNumber || 'NoRes').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `ticket-${cleanPassenger}-${cleanRes}-${dateStr}-${Date.now()}.json`;
    const filepath = path.join(dir, filename);
    
    // Save data with a timestamp for modified tracking
    const saveData = {
      filename,
      savedAt: new Date().toISOString(),
      ticket
    };
    
    fs.writeFileSync(filepath, JSON.stringify(saveData, null, 2));
    res.json({ success: true, filename, savedAt: saveData.savedAt });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/tickets - List all saved tickets
app.get("/api/tickets", (req, res) => {
  try {
    const dir = path.resolve(process.cwd(), 'saved_tickets');
    if (!fs.existsSync(dir)) {
      return res.json([]);
    }
    const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.json'));
    const tickets = files.map((file: string) => {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      return JSON.parse(content);
    }).sort((a: any, b: any) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()); // Sort newest first
    
    res.json(tickets);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/delete-ticket/:filename - Delete a saved ticket
app.delete("/api/delete-ticket/:filename", (req, res) => {
  try {
    const { filename } = req.params;
    const dir = path.resolve(process.cwd(), 'saved_tickets');
    const filepath = path.join(dir, filename || '');
    
    // Basic security check: make sure file is in saved_tickets folder and ends with .json
    if (filename && filename.endsWith('.json') && fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid file or file not found' });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/email-history
app.get("/api/email-history", (req, res) => {
  try {
    const historyDir = path.resolve(process.cwd(), 'sent_emails_history');
    if (!fs.existsSync(historyDir)) {
      return res.json([]);
    }
    const files = fs.readdirSync(historyDir).filter((f: string) => f.endsWith('.json'));
    const records = files.map((file: string) => {
      const content = fs.readFileSync(path.join(historyDir, file), 'utf-8');
      return JSON.parse(content);
    }).sort((a: any, b: any) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
 
    res.json(records);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/delete-email-history/:id
app.delete("/api/delete-email-history/:id", (req, res) => {
  try {
    const { id } = req.params;
    const historyDir = path.resolve(process.cwd(), 'sent_emails_history');
    const filepath = path.join(historyDir, `${id}.json`);
 
    if (id && fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Email history log not found' });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================================
// SMTP Configurations API
// ==========================================

// GET /api/smtp-configs - List all custom SMTP configurations
app.get("/api/smtp-configs", (req, res) => {
  try {
    const configsDir = path.join(process.cwd(), "smtp_configs");
    if (!fs.existsSync(configsDir)) {
      return res.json([]);
    }
    const files = fs.readdirSync(configsDir).filter((f: string) => f.endsWith(".json"));
    const configs = files.map((file: string) => {
      const content = fs.readFileSync(path.join(configsDir, file), "utf-8");
      return JSON.parse(content);
    });
    res.json(configs);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/smtp-configs - Add new SMTP configuration
app.post("/api/smtp-configs", (req, res) => {
  try {
    const { name, host, port, secure, user, pass, fromName, fromEmail } = req.body;
    if (!name || !host || !port || !user || !pass) {
      return res.status(400).json({ error: "Missing required SMTP details." });
    }
    const configsDir = path.join(process.cwd(), "smtp_configs");
    if (!fs.existsSync(configsDir)) {
      fs.mkdirSync(configsDir, { recursive: true });
    }
    const id = `smtp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const config = {
      id,
      name,
      host,
      port: parseInt(port),
      secure: secure === true || port === 465 || port === "465",
      user,
      pass,
      fromName: fromName || "Skypass Limo Inc",
      fromEmail: fromEmail || user,
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(configsDir, `${id}.json`), JSON.stringify(config, null, 2));
    res.json({ success: true, config });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/smtp-configs/:id - Update existing SMTP configuration
app.put("/api/smtp-configs/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { name, host, port, secure, user, pass, fromName, fromEmail } = req.body;
    if (!name || !host || !port || !user || !pass) {
      return res.status(400).json({ error: "Missing required SMTP details." });
    }
    const configsDir = path.join(process.cwd(), "smtp_configs");
    const filepath = path.join(configsDir, `${id}.json`);
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: "SMTP profile not found." });
    }
    const config = {
      id,
      name,
      host,
      port: parseInt(port),
      secure: secure === true || port === 465 || port === "465",
      user,
      pass,
      fromName: fromName || "Skypass Limo Inc",
      fromEmail: fromEmail || user,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(filepath, JSON.stringify(config, null, 2));
    res.json({ success: true, config });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/smtp-configs/:id - Delete custom SMTP configuration
app.delete("/api/smtp-configs/:id", (req, res) => {
  try {
    const { id } = req.params;
    const configsDir = path.join(process.cwd(), "smtp_configs");
    const filepath = path.join(configsDir, `${id}.json`);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "SMTP configuration not found" });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/smtp-configs/test - Send connection test email
app.post("/api/smtp-configs/test", async (req, res) => {
  try {
    const { host, port, secure, user, pass, testRecipient, fromName, fromEmail } = req.body;
    if (!host || !port || !user || !pass || !testRecipient) {
      return res.status(400).json({ error: "Missing SMTP credentials or test recipient email." });
    }
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port),
      secure: secure === true || port === 465 || port === "465",
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false
      }
    });

    const senderName = fromName || "Skypass Limo SMTP Test";
    const senderEmail = fromEmail || user;

    await transporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to: testRecipient,
      subject: "Skypass Limo Invoice - SMTP Connection Test",
      text: "Congratulations! Your custom SMTP connection has been successfully configured and tested.",
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; max-width: 600px; background-color: #ffffff;">
          <h2 style="color: #10b981; margin-top: 0; font-size: 20px;">SMTP Connection Test Successful</h2>
          <p>Your custom SMTP server configuration was verified successfully at <strong>${new Date().toLocaleString()}</strong>.</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <div style="background-color: #f8fafc; padding: 12px; border-radius: 6px; font-size: 13px; color: #334155;">
            <strong>Test Details:</strong><br/>
            • Host: ${host}<br/>
            • Port: ${port}<br/>
            • Sender: "${senderName}" &lt;${senderEmail}&gt;<br/>
            • Auth User: ${user}
          </div>
          <p style="font-size: 13px; color: #64748b; margin-top: 20px;">This email was sent to verify your SMTP settings. You can now use this profile to send automated invoices securely.</p>
        </div>
      `
    });

    res.json({ success: true, message: `Test email sent successfully to ${testRecipient}!` });
  } catch (e: any) {
    console.error("SMTP Test Error:", e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// POST /api/email-invoice
app.post("/api/email-invoice", async (req, res) => {
  try {
    const { email, subject, messageText, htmlBody, pdfBase64, filename, smtpConfigId } = req.body;
    if (!email || !htmlBody) {
      return res.status(400).json({ error: 'Missing recipient email address or HTML content' });
    }

    const emailList = typeof email === 'string'
      ? email.split(',').map((e: string) => e.trim()).filter(Boolean)
      : Array.isArray(email) ? email : [];

    if (emailList.length === 0) {
      return res.status(400).json({ error: 'No valid recipient email address specified' });
    }

    const historyDir = path.resolve(process.cwd(), 'sent_emails_history');
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true });
    }

    const timestamp = Date.now();
    const dateStr = new Date().toISOString();
    const recordId = `email-${timestamp}-${Math.floor(Math.random() * 10000)}`;

    // Fallback environment settings
    let smtpHost = process.env.SMTP_HOST;
    let smtpPort = process.env.SMTP_PORT;
    let smtpUser = process.env.SMTP_USER;
    let smtpPass = process.env.SMTP_PASS;
    let fromName = "Skypass Limo Inc";
    let fromEmail = smtpUser || "";

    // Resolve custom SMTP configuration if specified
    if (smtpConfigId && smtpConfigId !== "env" && smtpConfigId !== "default") {
      const configsDir = path.join(process.cwd(), "smtp_configs");
      const filepath = path.join(configsDir, `${smtpConfigId}.json`);
      if (fs.existsSync(filepath)) {
        try {
          const configContent = fs.readFileSync(filepath, "utf-8");
          const config = JSON.parse(configContent);
          smtpHost = config.host;
          smtpPort = String(config.port);
          smtpUser = config.user;
          smtpPass = config.pass;
          if (config.fromName) fromName = config.fromName;
          if (config.fromEmail) fromEmail = config.fromEmail;
          else fromEmail = config.user;
        } catch (err) {
          console.error("Failed to parse custom SMTP config, falling back to ENV:", err);
        }
      }
    }

    let sentStatus: 'success' | 'failed' | 'simulated' = 'simulated';
    let errorMessage: string | undefined = undefined;
    let responseMessage = '';

    if (smtpHost && smtpPort && smtpUser && smtpPass) {
      try {
        const nodemailer = await import('nodemailer');
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: parseInt(smtpPort),
          secure: smtpPort === '465',
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
          tls: {
            rejectUnauthorized: false
          }
        });

        const mailOptions: any = {
          from: `"${fromName}" <${fromEmail || smtpUser}>`,
          to: emailList.join(', '),
          subject: subject || 'Skypass Limo Invoice / Trip Ticket',
          text: messageText || 'Please view the attached/inline invoice from Skypass Limo Inc.',
          html: htmlBody,
        };

        if (pdfBase64) {
          mailOptions.attachments = [
            {
              filename: filename || 'invoice.pdf',
              content: Buffer.from(pdfBase64, 'base64'),
            }
          ];
        }

        await transporter.sendMail(mailOptions);
        sentStatus = 'success';
        responseMessage = `Email sent successfully to ${emailList.join(', ')}!`;
      } catch (mailErr: any) {
        sentStatus = 'failed';
        errorMessage = mailErr.message || String(mailErr);
        responseMessage = `Failed to send email via SMTP: ${errorMessage}`;
      }
    } else {
      responseMessage = `Email simulated! Sent to ${emailList.join(', ')}. (Enable SMTP_HOST, SMTP_PORT etc. or configure custom SMTP for real delivery)`;
    }

    const historyRecord = {
      id: recordId,
      sentAt: dateStr,
      recipients: emailList,
      subject: subject || 'Skypass Limo Invoice / Trip Ticket',
      messageText: messageText || '',
      htmlBody: htmlBody,
      status: sentStatus,
      errorMessage: errorMessage
    };

    fs.writeFileSync(
      path.join(historyDir, `${recordId}.json`),
      JSON.stringify(historyRecord, null, 2)
    );

    if (pdfBase64) {
      try {
        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
        const sentEmailsDir = path.resolve(process.cwd(), 'sent_emails');
        if (!fs.existsSync(sentEmailsDir)) {
          fs.mkdirSync(sentEmailsDir, { recursive: true });
        }
        fs.writeFileSync(path.join(sentEmailsDir, `${timestamp}-${filename || 'invoice.pdf'}`), pdfBuffer);
      } catch (pdfErr) {
        console.error("Failed to save PDF archive:", pdfErr);
      }
    }

    res.status(sentStatus === 'failed' ? 500 : 200).json({
      success: sentStatus !== 'failed',
      message: responseMessage,
      record: historyRecord
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/analyze - Inspect React code structure and suggest custom features
app.post("/api/analyze", async (req, res) => {
  try {
    const { files } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "No project files provided for analysis" });
    }

    // Filter down to interesting non-binary source files to prevent token bloat
    const textFiles = files.filter(f => !f.isBinary && f.content);
    const keyFiles = textFiles.filter(f => 
      f.path.includes("package.json") || 
      f.path.includes("App.") || 
      f.path.includes("index.css") || 
      f.path.includes("src/main.") ||
      f.path.includes("src/components/")
    ).slice(0, 15); // Limit to key files for performance and token boundaries

    const fileSummaryPrompt = keyFiles.map(f => `--- File: ${f.path} ---\n${f.content}`).join("\n\n");

    const prompt = `You are an elite React developer and architect.
Analyze the following React project files and provide:
1. An architectural summary.
2. A list of 4 highly relevant feature suggestions or visual/performance improvements that fit the project structure.

Input Files:
${fileSummaryPrompt}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description: "High-level summary of the React project structure, dependencies, and state management style."
            },
            suggestions: {
              type: Type.ARRAY,
              description: "Recommended features to add or parts to optimize.",
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING, description: "A short unique identifier (camelCase) for the feature, e.g. 'darkMode', 'userAuthentication'." },
                  title: { type: Type.STRING, description: "Engaging short title of the feature." },
                  description: { type: Type.STRING, description: "Explanation of what the feature does and why it is useful." },
                  category: { type: Type.STRING, description: "e.g., Performance, Visuals, Security, State Management" },
                  difficulty: { type: Type.STRING, description: "Easy, Medium, or Hard" }
                },
                required: ["id", "title", "description", "category", "difficulty"]
              }
            }
          },
          required: ["summary", "suggestions"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Empty response received from Gemini model");
    }

    res.json(JSON.parse(resultText.trim()));
  } catch (error: any) {
    console.error("Analysis Error:", error);
    res.status(500).json({ error: error.message || "An error occurred during project analysis." });
  }
});

// POST /api/enhance - Injects features or applies customized code transformations
app.post("/api/enhance", async (req, res) => {
  try {
    const { files, prompt: userPrompt, selectedFeatureId } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "No files provided for enhancement" });
    }

    // Filter down files to contextualize
    const textFiles = files.filter(f => !f.isBinary && f.content);
    const contextFilesText = textFiles.map(f => `Path: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n");

    const systemInstruction = `You are an elite full-stack React engineer.
Your task is to implement the requested feature or modification on the uploaded React project.
You must modify existing files or create new files to integrate this feature cleanly.

Follow these strict guidelines:
1. Always return complete, production-ready code. NEVER use placeholders, triple-dots (...), or comment blocks indicating "rest of code goes here".
2. If modifying App.jsx/App.tsx, ensure the existing components, style, and structure are preserved but enhanced.
3. If importing styles or libraries, ensure they are compatible with standard React and Tailwind CSS.
4. Output your response as a structured JSON containing:
   - "modifiedFiles": A list of files to overwrite or create, with their exact paths and full contents.
   - "message": A polite, conversational explanation in Bengali or English (matching the user's inquiry style if they used Bengali) detailing how to run and test the new feature.`;

    const modelInput = `Here are the current files in the React project:

${contextFilesText}

Requested Enhancement / Prompt:
${userPrompt || `Apply the feature: ${selectedFeatureId}`}

Return the full modified files and a summary of your actions according to the schema.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: modelInput,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            modifiedFiles: {
              type: Type.ARRAY,
              description: "List of files that are modified or created to support the feature.",
              items: {
                type: Type.OBJECT,
                properties: {
                  path: { type: Type.STRING, description: "Full relative path to the file (e.g. 'src/App.jsx', 'src/components/AuthContext.jsx')." },
                  content: { type: Type.STRING, description: "The full, non-abbreviated contents of the file." }
                },
                required: ["path", "content"]
              }
            },
            message: {
              type: Type.STRING,
              description: "Helpful guide on what was done and how the features operate."
            }
          },
          required: ["modifiedFiles", "message"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("No response content generated by Gemini.");
    }

    res.json(JSON.parse(resultText.trim()));
  } catch (error: any) {
    console.error("Enhancement Error:", error);
    res.status(500).json({ error: error.message || "An error occurred during code enhancement." });
  }
});

// Initialize Express + Vite Setup
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
