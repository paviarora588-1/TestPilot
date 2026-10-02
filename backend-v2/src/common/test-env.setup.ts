import { randomBytes } from 'crypto';

// Unit tests use ephemeral keys, never real application credentials.
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString('hex');
process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString('hex');
