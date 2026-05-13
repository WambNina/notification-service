const db = require('../config/db');
const emailService = require('../services/email/emailService');
const crypto = require('crypto');
const fs = require('fs').promises;

// Generate unique tracking token
const generateToken = () => crypto.randomBytes(32).toString('hex');

// ==========================================
// POST /api/message - Send a new message
// ==========================================
exports.sendMessage = async (req, res) => {
  let messageId = null;
  console.log('[POST /api/message] Request received');

  try {
    const { from, to, subject, text } = req.body;
    console.log('[POST /api/message] Body:', { from, to, subject, text: text?.substring(0, 50) });

    // Validation
    if (!from || !to || !subject || !text) {
      console.log('[POST /api/message] Validation failed - missing fields');
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: from, to, subject, text',
      });
    }

    const attachmentPath = req.file ? req.file.path : null;
    const trackingToken = generateToken();
    console.log('[POST /api/message] Generated tracking token:', trackingToken);

    // Save to DB
    const query = `
      INSERT INTO messages (sender_email, recipient_email, subject, message_text, attachment_path, status, tracking_token)
      VALUES (?, ?, ?, ?, ?, 'sent', ?)
    `;
    const [result] = await db.execute(query, [from, to, subject, text, attachmentPath, trackingToken]);
    messageId = result.insertId;
    console.log('[POST /api/message] Saved to DB with ID:', messageId);

    // Build tracking pixel URL
    const host = req.get('host');
    const protocol = req.protocol;
    const trackingUrl = `${protocol}://${host}/api/track/${trackingToken}`;
    console.log('[POST /api/message] Tracking URL:', trackingUrl);

    // Build HTML body with tracking pixel
    const htmlBody = `
      <div style="font-family: Arial, sans-serif;">
        <p>${text.replace(/\n/g, '<br>')}</p>
        <img src="${trackingUrl}" width="1" height="1" alt="" style="display:block;" />
      </div>
    `;

    // Prepare attachments
    const attachments = [];
    if (req.file) {
      attachments.push({
        filename: req.file.originalname,
        path: req.file.path,
      });
      console.log('[POST /api/message] Attachment added:', req.file.originalname);
    }

    // Send email
    console.log('[POST /api/message] Sending email via Nodemailer...');
    await emailService.sendEmail({ from, to, subject, text, html: htmlBody, attachments });
    console.log('[POST /api/message] Email sent successfully');

    res.status(200).json({
      success: true,
      message: 'Message sent and saved successfully',
      data: {
        id: messageId,
        from,
        to,
        subject,
        text,
        attachment: req.file ? req.file.originalname : null,
        status: 'sent',
        trackingToken,
      },
    });
  } catch (error) {
    console.error('[POST /api/message] ERROR:', error.message);

    if (req.file) {
      try { await fs.unlink(req.file.path); } catch (e) {}
    }

    if (messageId) {
      try {
        await db.execute('UPDATE messages SET status = ? WHERE id = ?', ['failed', messageId]);
        console.log('[POST /api/message] Marked message', messageId, 'as failed');
      } catch (dbErr) {
        console.error('[POST /api/message] Failed to update status:', dbErr.message);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message,
    });
  }
};

// ==========================================
// GET /api/messages - List all messages
// ==========================================
exports.getAllMessages = async (req, res) => {
  console.log('[GET /api/messages] Request received');
  console.log('[GET /api/messages] Query params:', req.query);

  try {
    const { email, subject, text, page = 1, limit = 10 } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const searchLimit = parseInt(limit);
    const params = [];
    const conditions = [];

    if (email) {
      conditions.push('(sender_email LIKE ? OR recipient_email LIKE ?)');
      const emailPattern = `%${email}%`;
      params.push(emailPattern, emailPattern);
    }

    if (subject) {
      conditions.push('subject LIKE ?');
      params.push(`%${subject}%`);
    }

    if (text) {
      conditions.push('message_text LIKE ?');
      params.push(`%${text}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countQuery = `SELECT COUNT(*) as total FROM messages ${whereClause}`;
    const [countResult] = await db.execute(countQuery, params);
    const total = countResult[0].total;
    console.log('[GET /api/messages] Total records:', total);

    // Fetch data
    const dataQuery = `
      SELECT 
        id,
        sender_email as from_email,
        recipient_email as to_email,
        subject,
        message_text as text,
        attachment_path,
        status,
        created_at,
        read_at
      FROM messages
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await db.execute(dataQuery, [...params, searchLimit, offset]);
    console.log('[GET /api/messages] Records returned:', rows.length);

    const totalPages = Math.ceil(total / searchLimit);
    const currentPage = parseInt(page);

    res.status(200).json({
      success: true,
      message: 'Messages retrieved successfully',
      data: rows,
      pagination: {
        total,
        totalPages,
        currentPage,
        limit: searchLimit,
        hasNextPage: currentPage < totalPages,
        hasPrevPage: currentPage > 1,
      },
    });
  } catch (error) {
    console.error('[GET /api/messages] ERROR:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve messages',
      error: error.message,
    });
  }
};

// ==========================================
// GET /api/track/:token - Tracking pixel
// Returns 1x1 PNG, marks message as read
// ==========================================
exports.trackMessage = async (req, res) => {
  const { token } = req.params;
  console.log('[GET /api/track/:token] Tracking pixel requested. Token:', token);

  try {
    // Find message by tracking token
    const [rows] = await db.execute(
      'SELECT id, status FROM messages WHERE tracking_token = ?',
      [token]
    );

    if (rows.length === 0) {
      console.log('[GET /api/track/:token] Token not found in DB');
      return sendPixel(res);
    }

    const message = rows[0];
    console.log('[GET /api/track/:token] Found message ID:', message.id, '| Current status:', message.status);

    // Mark as read if still sent
    if (message.status === 'sent') {
      await db.execute(
        'UPDATE messages SET status = ?, read_at = NOW() WHERE id = ?',
        ['read', message.id]
      );
      console.log('[GET /api/track/:token] Message', message.id, 'marked as READ');
    } else {
      console.log('[GET /api/track/:token] Message already read, no update needed');
    }

    sendPixel(res);
  } catch (error) {
    console.error('[GET /api/track/:token] ERROR:', error.message);
    sendPixel(res);
  }
};

// Helper: Send 1x1 transparent PNG
function sendPixel(res) {
  console.log('[sendPixel] Returning 1x1 transparent PNG');
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(pixel);
}