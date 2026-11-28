import { ApiError } from '../utils/apiError.js';

export default function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    const response = { error: err.message };
    if (err.details !== undefined) {
      response.details = err.details;
    }
    return res.status(err.status).json(response);
  }

  console.error(err);
  return res.status(500).json({ error: 'Something went wrong' });
}
