import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  PORT: Joi.number().default(3210),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().default(5432),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),
  DATABASE_SSL: Joi.boolean().truthy('true').default(false),
  TYPEORM_SYNC: Joi.boolean().truthy('true').default(false),
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_EXPIRES: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_EXPIRES: Joi.string().default('30d'),
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
  GOOGLE_REDIRECT_URI: Joi.string()
    .uri({ allowRelative: true })
    .default('http://localhost:14100/callback'),
  R2_ACCOUNT_ID: Joi.string().allow('').default(''),
  R2_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  R2_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  R2_BUCKET: Joi.string().allow('').default(''),
  R2_ENDPOINT: Joi.string().uri().allow('').default(''),
  PADDLE_ENV: Joi.string().valid('sandbox', 'production').default('sandbox'),
  PADDLE_API_KEY: Joi.string().allow('').default(''),
  PADDLE_CLIENT_TOKEN: Joi.string().allow('').default(''),
  PADDLE_WEBHOOK_SECRET: Joi.string().allow('').default(''),
  PADDLE_PRICE_MONTHLY_ID: Joi.string().allow('').default(''),
  PADDLE_PRICE_YEARLY_ID: Joi.string().allow('').default(''),
  PUBLIC_BASE_URL: Joi.string().uri().allow('').default('http://localhost:3210'),
  CORS_ORIGINS: Joi.string().default('http://localhost:1420'),
});