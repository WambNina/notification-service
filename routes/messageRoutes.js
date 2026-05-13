const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const messageController = require('../controllers/messageController');

/**
 * @swagger
 * tags:
 *   name: Messages
 *   description: Notification message endpoints
 */

/**
 * @swagger
 * /api/message:
 *   post:
 *     summary: Send a notification message with optional image attachment
 *     description: Saves message to MySQL and sends email via Gmail SMTP. Includes a tracking pixel to detect when the email is opened.
 *     tags: [Messages]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - from
 *               - to
 *               - subject
 *               - text
 *             properties:
 *               from:
 *                 type: string
 *                 format: email
 *                 example: sender@gmail.com
 *               to:
 *                 type: string
 *                 format: email
 *                 example: recipient@gmail.com
 *               subject:
 *                 type: string
 *                 example: Project Update
 *               text:
 *                 type: string
 *                 example: Here is the latest update on your request.
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Optional image attachment. Max 5MB.
 *     responses:
 *       200:
 *         description: Message sent successfully
 *       400:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.post('/message', upload.single('image'), messageController.sendMessage);

/**
 * @swagger
 * /api/messages:
 *   get:
 *     summary: Get all messages with search and pagination
 *     description: Search by email (sender/recipient), subject, or message text. Returns paginated results.
 *     tags: [Messages]
 *     parameters:
 *       - in: query
 *         name: email
 *         schema:
 *           type: string
 *         description: Search in sender or recipient email (partial match)
 *         example: john@gmail.com
 *       - in: query
 *         name: subject
 *         schema:
 *           type: string
 *         description: Search in subject line (partial match)
 *         example: Project
 *       - in: query
 *         name: text
 *         schema:
 *           type: string
 *         description: Search in message body (partial match)
 *         example: update
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *     responses:
 *       200:
 *         description: Paginated list of messages
 *       500:
 *         description: Server error
 */
router.get('/messages', messageController.getAllMessages);

// Tracking pixel endpoint (internal - not documented in Swagger)
router.get('/track/:token', messageController.trackMessage);

module.exports = router;