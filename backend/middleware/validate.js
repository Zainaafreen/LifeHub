/**
 * validate.js — Zod-based request validation middleware
 *
 * Usage:
 *   const { validate, schemas } = require('../middleware/validate');
 *   router.post('/tasks', authenticate, validate(schemas.createTask), createTask);
 *
 * On failure, responds 400 with:
 *   { error: 'Validation error', details: [{ field, message }] }
 */

const { z } = require('zod');

// ── Reusable field definitions ────────────────────────────────
const email    = z.string().email('Please enter a valid email address').max(150, 'Email must be 150 characters or fewer').transform(v => v.toLowerCase().trim());
const password = z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password must be 72 characters or fewer');
const priority = z.enum(['low', 'medium', 'high'], { errorMap: () => ({ message: 'Priority must be low, medium, or high' }) });

// ── Schemas ───────────────────────────────────────────────────
const schemas = {

  // Auth
  register: z.object({
    name:     z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer').transform(v => v.trim()),
    email,
    password,
  }),

  login: z.object({
    email:    z.string().min(1, 'Email is required'),
    password: z.string().min(1, 'Password is required'),
  }),

  resendVerification: z.object({
    email: z.string().email('Please enter a valid email address'),
  }),

  // Password reset
  forgotPassword: z.object({
    email: z.string().email('Please enter a valid email address'),
  }),

  resetPassword: z.object({
    token:    z.string().regex(/^[0-9a-f]{64}$/, 'Invalid reset token'),
    password,
  }),

  // Tasks
  createTask: z.object({
    title:    z.string().min(1, 'Task title is required').max(255, 'Task title must be 255 characters or fewer').transform(v => v.trim()),
    priority: priority.optional().default('medium'),
  }),

  updateTask: z.object({
    title:     z.string().min(1).max(255).transform(v => v.trim()).optional(),
    completed: z.boolean().optional(),
    priority:  priority.optional(),
  }).refine(data => Object.keys(data).length > 0, { message: 'Nothing to update' }),

  // Expenses
  createExpense: z.object({
    type:        z.enum(['income', 'expense'], { errorMap: () => ({ message: 'Type must be "income" or "expense"' }) }),
    category:    z.string().min(1, 'Category is required').max(100, 'Category must be 100 characters or fewer').transform(v => v.trim()),
    amount:      z.number({ invalid_type_error: 'Amount must be a number' }).positive('Amount must be a positive number'),
    description: z.string().max(500, 'Description must be 500 characters or fewer').transform(v => v.trim()).optional().nullable(),
    date:        z.string().optional(),
  }),

  updateExpense: z.object({
    type:        z.enum(['income', 'expense']).optional(),
    category:    z.string().min(1).max(100).transform(v => v.trim()).optional(),
    amount:      z.number().positive('Amount must be a positive number').optional(),
    description: z.string().max(500).transform(v => v.trim()).optional().nullable(),
    date:        z.string().optional(),
  }).refine(data => Object.keys(data).length > 0, { message: 'No fields to update' }),

  // Reminders
  createReminder: z.object({
    title:       z.string().min(1, 'Title is required').max(255, 'Title must be 255 characters or fewer').transform(v => v.trim()),
    description: z.string().max(1000, 'Description must be 1000 characters or fewer').transform(v => v.trim()).optional().nullable(),
    remind_at:   z.string().refine(v => !isNaN(new Date(v).getTime()), { message: 'Invalid date/time format' }),
  }),

  // Health
  createHealthRecord: z.object({
    heartbeat:   z.number().int().min(1).max(300).optional().nullable(),
    systolic:    z.number().int().min(1).max(300).optional().nullable(),
    diastolic:   z.number().int().min(1).max(200).optional().nullable(),
    blood_sugar: z.number().positive().max(1000).optional().nullable(),
    notes:       z.string().max(2000).optional().nullable(),
  }).refine(
    d => d.heartbeat || d.systolic || d.blood_sugar,
    { message: 'At least one health metric is required' }
  ),
};

// ── Middleware factory ────────────────────────────────────────
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.errors.map(e => ({
        field:   e.path.join('.') || 'body',
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation error', details });
    }
    // Replace req.body with the parsed+transformed data
    req.body = result.data;
    next();
  };
}

module.exports = { validate, schemas };
