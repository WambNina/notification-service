const db = require('../config/supabase');
const emailService = require('../services/email/emailService');
const crypto = require('crypto');
const fs = require('fs').promises;

const generateToken = () => crypto.randomBytes(32).toString('hex');

// ==========================================
// POST /api/message
// ==========================================
exports.sendMessage = async (req, res) => {
  let messageId = null;
  console.log('[POST /api/message] Request received');

  try {
    const { from, to, subject, text } = req.body;
    console.log('[POST /api/message] Body:', { from, to, subject, text: text?.substring(0, 50) });

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

    // PostgreSQL INSERT with RETURNING id
    const query = `
      INSERT INTO messages (sender_email, recipient_email, subject, message_text, attachment_path, status, tracking_token)
      VALUES ($1, $2, $3, $4, $5, 'sent', $6)
      RETURNING id
    `;
    const result = await db.query(query, [from, to, subject, text, attachmentPath, trackingToken]);
    messageId = result.rows[0].id;
    console.log('[POST /api/message] Saved to DB with ID:', messageId);

    // Build tracking pixel URL
    const publicUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const trackingUrl = `${publicUrl}/api/track/${trackingToken}`;
    console.log('[POST /api/message] Tracking URL:', trackingUrl);

    const htmlBody = `
      <div style="font-family: Arial, sans-serif;">
        <p>${text.replace(/\n/g, '<br>')}</p>
        <img src="${trackingUrl}" width="1" height="1" alt="" style="display:block;" />
      </div>
    `;

    const attachments = [];
    if (req.file) {
      attachments.push({
        filename: req.file.originalname,
        path: req.file.path,
      });
      console.log('[POST /api/message] Attachment added:', req.file.originalname);
    }

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
        await db.query('UPDATE messages SET status = $1 WHERE id = $2', ['failed', messageId]);
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
// GET /api/messages - List/Search/Paginate
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
    let paramIndex = 1;

    if (email) {
      conditions.push(`(sender_email ILIKE $${paramIndex} OR recipient_email ILIKE $${paramIndex + 1})`);
      const emailPattern = `%${email}%`;
      params.push(emailPattern, emailPattern);
      paramIndex += 2;
    }

    if (subject) {
      conditions.push(`subject ILIKE $${paramIndex}`);
      params.push(`%${subject}%`);
      paramIndex += 1;
    }

    if (text) {
      conditions.push(`message_text ILIKE $${paramIndex}`);
      params.push(`%${text}%`);
      paramIndex += 1;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countQuery = `SELECT COUNT(*) AS total FROM messages ${whereClause}`;
    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);
    console.log('[GET /api/messages] Total records:', total);

    // Fetch paginated rows
    const dataParams = [...params, searchLimit, offset];
    const dataQuery = `
      SELECT 
        id,
        sender_email AS from_email,
        recipient_email AS to_email,
        subject,
        message_text AS text,
        attachment_path,
        status,
        created_at,
        read_at
      FROM messages
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const dataResult = await db.query(dataQuery, dataParams);
    const rows = dataResult.rows;
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
// ==========================================
exports.trackMessage = async (req, res) => {
  const { token } = req.params;
  console.log('[GET /api/track/:token] Tracking pixel requested. Token:', token);

  try {
    const result = await db.query(
      'SELECT id, status FROM messages WHERE tracking_token = $1',
      [token]
    );

    if (result.rows.length === 0) {
      console.log('[GET /api/track/:token] Token not found in DB');
      return sendPixel(res);
    }

    const message = result.rows[0];
    console.log('[GET /api/track/:token] Found message ID:', message.id, '| Current status:', message.status);

    if (message.status === 'sent') {
      await db.query(
        'UPDATE messages SET status = $1, read_at = NOW() WHERE id = $2',
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