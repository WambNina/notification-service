// services/email/emailService.js
const transporter = require('../../config/email');

exports.sendEmail = async ({ from, to, subject, text, html, attachments = [] }) => {
  console.log('[emailService] Preparing to send email to:', to);

  const mailOptions = {
    from: `"Notification Service" <${from}>`,
    to,
    subject,
    text,   // Plain text fallback for non-HTML clients
    html,   // HTML body with tracking pixel
    attachments,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log('[emailService] Email sent. MessageId:', info.messageId);
  return info;
};