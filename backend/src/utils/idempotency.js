const crypto = require('crypto');
const pool = require('../db');

function hashRequest(req) {
  const material = JSON.stringify({ method: req.method, path: req.originalUrl, body: req.body });
  return crypto.createHash('sha256').update(material).digest('hex');
}

// Attach to any mutating route (create/update/delete). The mobile client
// must send an 'X-Operation-Id' header (a client-generated UUID) that it
// reuses when retrying the same logical operation — e.g. after a dropped
// response or before a manual sync retries a queued mutation.
//
//  - New operation_id  -> handler runs normally; response is stored.
//  - Same id, same body -> stored response is replayed, handler is
//    NOT re-run, so a lost response can never cause a duplicate effect.
//  - Same id, different body -> rejected, since silently accepting a
//    changed payload under a reused id would hide a bug or an attack.
async function idempotent(req, res, next) {
  const operationId = req.headers['x-operation-id'];
  if (!operationId) {
    return res.status(400).json({ error: 'OPERATION_ID_REQUIRED', message: 'X-Operation-Id header is required for this action' });
  }

  const requestHash = hashRequest(req);
  const [rows] = await pool.query(
    'SELECT response_status, response_body, request_hash FROM operation_receipts WHERE operation_id = :id',
    { id: operationId }
  );
  const existing = rows[0];

  if (existing) {
    if (existing.request_hash !== requestHash) {
      return res.status(409).json({
        error: 'OPERATION_ID_REUSED',
        message: 'This operation id was already used with different content',
      });
    }
    return res.status(existing.response_status).json(existing.response_body);
  }

  // Capture the eventual response so it can be stored after the handler runs.
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    pool
      .query(
        `INSERT INTO operation_receipts (operation_id, account_id, endpoint, request_hash, response_status, response_body)
         VALUES (:id, :accountId, :endpoint, :hash, :status, :body)
         ON DUPLICATE KEY UPDATE operation_id = operation_id`, // no-op if a racing request already inserted it
        {
          id: operationId,
          accountId: req.user.accountId,
          endpoint: req.originalUrl,
          hash: requestHash,
          status: res.statusCode,
          body: JSON.stringify(body),
        }
      )
      .catch((err) => console.error('Failed to store operation receipt', err));
    return originalJson(body);
  };

  next();
}

module.exports = { idempotent };
