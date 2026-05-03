/**
 * validate.js — Zod schemas + Express middleware helper
 *
 * Usage in a controller:
 *   const { z, validate } = require('../config/validate');
 *   const schema = z.object({ title: z.string().min(1).max(255) });
 *   router.post('/', validate(schema), handler);
 *
 * On failure it returns:
 *   HTTP 400 { error: 'Validation failed', details: [...] }
 */

let z;
try {
  z = require('zod').z;
  if (!z) z = require('zod');
} catch {
  // Zod not installed — will be caught at startup
  throw new Error('zod is required: run npm install zod');
}

/**
 * Express middleware that validates req.body against a Zod schema.
 * On success it replaces req.body with the parsed (coerced + stripped) value.
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.errors.map(e => ({
        field:   e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation failed', details });
    }
    req.body = result.data;
    next();
  };
}

/**
 * Express middleware that validates req.query against a Zod schema.
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const details = result.error.errors.map(e => ({
        field:   e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation failed', details });
    }
    req.query = result.data;
    next();
  };
}

// ── Reusable field schemas ──────────────────────────────────────────────────
const email = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .email('Please enter a valid email address')
  .max(150, 'Email must be 150 characters or fewer');

const password = z
  .string({ required_error: 'Password is required' })
  .min(8,  'Password must be at least 8 characters')
  .max(72, 'Password must be 72 characters or fewer');

const name = z
  .string({ required_error: 'Name is required' })
  .trim()
  .min(1,   'Name is required')
  .max(100, 'Name must be 100 characters or fewer');

// ── Auth schemas ────────────────────────────────────────────────────────────
const registerSchema = z.object({ name, email, password });

const loginSchema = z.object({ email, password: z.string().min(1, 'Password is required') });

const resendSchema = z.object({ email });

const forgotPasswordSchema = z.object({ email });

const resetPasswordSchema = z.object({
  token:    z.string().regex(/^[0-9a-f]{64}$/, 'Invalid reset token'),
  password,
});

// ── Task schemas ────────────────────────────────────────────────────────────
const PRIORITIES = ['low', 'medium', 'high'];

const createTaskSchema = z.object({
  title:    z.string().trim().min(1, 'Task title is required').max(255, 'Title must be 255 characters or fewer'),
  priority: z.enum(PRIORITIES).default('medium'),
});

const updateTaskSchema = z.object({
  title:     z.string().trim().min(1).max(255).optional(),
  completed: z.boolean().optional(),
  priority:  z.enum(PRIORITIES).optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Nothing to update' });

// ── Expense schemas ─────────────────────────────────────────────────────────
const createExpenseSchema = z.object({
  type:        z.enum(['income', 'expense'], { required_error: 'Type is required' }),
  category:    z.string().trim().min(1, 'Category is required').max(100, 'Category must be 100 characters or fewer'),
  amount:      z.number({ invalid_type_error: 'Amount must be a number' }).positive('Amount must be positive').max(999999999999, 'Amount too large'),
  description: z.string().trim().max(500, 'Description must be 500 characters or fewer').optional().nullable(),
  date:        z.string().date('Date must be YYYY-MM-DD').optional(),
});

const updateExpenseSchema = createExpenseSchema.partial().refine(
  d => Object.keys(d).length > 0, { message: 'Nothing to update' }
);

// ── Reminder schemas ────────────────────────────────────────────────────────
const createReminderSchema = z.object({
  title:       z.string().trim().min(1, 'Title is required').max(255, 'Title must be 255 characters or fewer'),
  description: z.string().trim().max(1000, 'Description must be 1000 characters or fewer').optional().nullable(),
  remind_at:   z.string().datetime({ offset: true, message: 'remind_at must be an ISO 8601 datetime' }),
});

// ── Health schemas ──────────────────────────────────────────────────────────
const createHealthSchema = z.object({
  heartbeat:   z.number().int().min(1).max(300).optional().nullable(),
  systolic:    z.number().int().min(1).max(300).optional().nullable(),
  diastolic:   z.number().int().min(1).max(200).optional().nullable(),
  blood_sugar: z.number().min(1).max(2000).optional().nullable(),
  notes:       z.string().trim().max(2000, 'Notes must be 2000 characters or fewer').optional().nullable(),
}).refine(
  d => d.heartbeat || d.systolic || d.diastolic || d.blood_sugar,
  { message: 'At least one health metric is required' }
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword:     password,
}).refine(d => d.currentPassword !== d.newPassword, {
  message: 'New password must differ from current password',
  path: ['newPassword'],
});

module.exports = {
  z,
  validate,
  validateQuery,
  registerSchema,
  loginSchema,
  resendSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  createTaskSchema,
  updateTaskSchema,
  createExpenseSchema,
  updateExpenseSchema,
  createReminderSchema,
  createHealthSchema,
};
