import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import fs from 'fs';

// custom plugin for saving and loading tickets locally
const localTicketDatabase = () => ({
  name: 'local-ticket-database',
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: any) => {
      if (req.url === '/api/save-ticket' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: any) => body += chunk);
        req.on('end', () => {
          try {
            const ticket = JSON.parse(body);
            const dir = path.resolve(process.cwd(), 'saved_tickets');
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            
            // Clean up the name for safe filename
            const cleanPassenger = (ticket.passenger || 'Unknown').replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const cleanRes = (ticket.resNumber || 'NoRes').replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const dateStr = new Date().toISOString().slice(0, 10);
            const filename = `ticket-${cleanPassenger}-${cleanRes}-${dateStr}.json`;
            const filepath = path.join(dir, filename);
            
            // Save data with a timestamp for modified tracking
            const saveData = {
              filename,
              savedAt: new Date().toISOString(),
              ticket
            };
            
            fs.writeFileSync(filepath, JSON.stringify(saveData, null, 2));
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, filename, savedAt: saveData.savedAt }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      } else if (req.url === '/api/tickets' && req.method === 'GET') {
        try {
          const dir = path.resolve(process.cwd(), 'saved_tickets');
          if (!fs.existsSync(dir)) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify([]));
            return;
          }
          const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.json'));
          const tickets = files.map((file: string) => {
            const content = fs.readFileSync(path.join(dir, file), 'utf-8');
            return JSON.parse(content);
          }).sort((a: any, b: any) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()); // Sort newest first
          
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(tickets));
        } catch (e: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        }
      } else if (req.url && req.url.startsWith('/api/delete-ticket/') && req.method === 'DELETE') {
        try {
          const filename = req.url.split('/').pop();
          const dir = path.resolve(process.cwd(), 'saved_tickets');
          const filepath = path.join(dir, filename || '');
          
          // Basic security check: make sure file is in saved_tickets folder and ends with .json
          if (filename && filename.endsWith('.json') && fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
          } else {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid file or file not found' }));
          }
        } catch (e: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        }
      } else if (req.url === '/api/email-invoice' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: any) => body += chunk);
        req.on('end', async () => {
          try {
            const { email, subject, messageText, htmlBody, pdfBase64, filename } = JSON.parse(body);
            if (!email || !htmlBody) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing recipient email address or HTML content' }));
              return;
            }

            // Parse multiple email addresses
            const emailList = typeof email === 'string'
              ? email.split(',').map((e: string) => e.trim()).filter(Boolean)
              : Array.isArray(email) ? email : [];

            if (emailList.length === 0) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'No valid recipient email address specified' }));
              return;
            }

            const historyDir = path.resolve(process.cwd(), 'sent_emails_history');
            if (!fs.existsSync(historyDir)) {
              fs.mkdirSync(historyDir, { recursive: true });
            }

            const timestamp = Date.now();
            const dateStr = new Date().toISOString();
            const recordId = `email-${timestamp}-${Math.floor(Math.random() * 10000)}`;

            const smtpHost = process.env.SMTP_HOST;
            const smtpPort = process.env.SMTP_PORT;
            const smtpUser = process.env.SMTP_USER;
            const smtpPass = process.env.SMTP_PASS;

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
                });

                const mailOptions: any = {
                  from: `"Skypass Limo Inc" <${smtpUser}>`,
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
              responseMessage = `Email simulated! Sent to ${emailList.join(', ')}. (Enable SMTP_HOST, SMTP_PORT etc. for real delivery)`;
            }

            // Save history record
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

            // Also save pdf separately if provided to preserve existing behavior
            if (pdfBase64) {
              try {
                const pdfBuffer = Buffer.from(pdfBase64, 'base64');
                const sentEmailsDir = path.resolve(process.cwd(), 'sent_emails');
                if (!fs.existsSync(sentEmailsDir)) {
                  fs.mkdirSync(sentEmailsDir, { recursive: true });
                }
                const savedPdfPath = path.join(sentEmailsDir, `${timestamp}-${filename || 'invoice.pdf'}`);
                fs.writeFileSync(savedPdfPath, pdfBuffer);
              } catch (pdfErr) {
                console.error("Failed to save PDF archive:", pdfErr);
              }
            }

            res.statusCode = sentStatus === 'failed' ? 500 : 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              success: sentStatus !== 'failed',
              message: responseMessage,
              record: historyRecord
            }));
          } catch (e: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      } else if (req.url === '/api/email-history' && req.method === 'GET') {
        try {
          const historyDir = path.resolve(process.cwd(), 'sent_emails_history');
          if (!fs.existsSync(historyDir)) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify([]));
            return;
          }
          const files = fs.readdirSync(historyDir).filter((f: string) => f.endsWith('.json'));
          const records = files.map((file: string) => {
            const content = fs.readFileSync(path.join(historyDir, file), 'utf-8');
            return JSON.parse(content);
          }).sort((a: any, b: any) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(records));
        } catch (e: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        }
      } else if (req.url && req.url.startsWith('/api/delete-email-history/') && req.method === 'DELETE') {
        try {
          const id = req.url.split('/').pop();
          const historyDir = path.resolve(process.cwd(), 'sent_emails_history');
          const filepath = path.join(historyDir, `${id}.json`);

          if (id && fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
          } else {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Email history log not found' }));
          }
        } catch (e: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        }
      } else if (req.url === '/api/smtp-configs' && req.method === 'GET') {
        try {
          const configsDir = path.resolve(process.cwd(), 'smtp_configs');
          if (!fs.existsSync(configsDir)) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify([]));
            return;
          }
          const files = fs.readdirSync(configsDir).filter((f: string) => f.endsWith('.json'));
          const configs = files.map((file: string) => {
            const content = fs.readFileSync(path.join(configsDir, file), 'utf-8');
            return JSON.parse(content);
          });
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(configs));
        } catch (e: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        }
      } else if (req.url === '/api/smtp-configs' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: any) => body += chunk);
        req.on('end', () => {
          try {
            const { name, host, port, secure, user, pass, fromName, fromEmail } = JSON.parse(body);
            if (!name || !host || !port || !user || !pass) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Missing required SMTP details." }));
              return;
            }
            const configsDir = path.resolve(process.cwd(), 'smtp_configs');
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
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, config }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      } else if (req.url && req.url.startsWith('/api/smtp-configs/') && req.method === 'PUT') {
        const id = req.url.split('/').pop();
        let body = '';
        req.on('data', (chunk: any) => body += chunk);
        req.on('end', () => {
          try {
            const { name, host, port, secure, user, pass, fromName, fromEmail } = JSON.parse(body);
            if (!name || !host || !port || !user || !pass) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Missing required SMTP details." }));
              return;
            }
            const configsDir = path.resolve(process.cwd(), 'smtp_configs');
            const filepath = path.join(configsDir, `${id}.json`);
            if (!fs.existsSync(filepath)) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: "SMTP profile not found." }));
              return;
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
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, config }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      } else if (req.url && req.url.startsWith('/api/smtp-configs/') && req.method === 'DELETE') {
        try {
          const id = req.url.split('/').pop();
          const configsDir = path.resolve(process.cwd(), 'smtp_configs');
          const filepath = path.join(configsDir, `${id}.json`);
          if (id && fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
          } else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "SMTP profile not found." }));
          }
        } catch (e: any) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        }
      } else if (req.url === '/api/smtp-configs/test' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: any) => body += chunk);
        req.on('end', async () => {
          try {
            const { host, port, secure, user, pass, testRecipient, fromName, fromEmail } = JSON.parse(body);
            if (!host || !port || !user || !pass || !testRecipient) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Missing SMTP credentials or test recipient email." }));
              return;
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

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: `Test email sent successfully to ${testRecipient}!` }));
          } catch (e: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      } else {
        next();
      }
    });
  }
});

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), localTicketDatabase()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/backup2/**'] },
    },
  };
});
