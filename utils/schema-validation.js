/**
 * JSON Schema Validation Utility
 * Provides schema-based validation for API request bodies
 */

const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true, coerceTypes: true });

// Custom formats
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
ajv.addFormat('datetime', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
ajv.addFormat('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/);

// Schemas for different request types
const schemas = {
  // User registration
  registerUser: {
    type: 'object',
    properties: {
      username: { 
        type: 'string', 
        minLength: 3, 
        maxLength: 30,
        pattern: '^[a-zA-Z0-9_]+$'
      },
      password: { 
        type: 'string', 
        minLength: 8, 
        maxLength: 128 
      },
      email: {
        type: 'string',
        format: 'email',
        maxLength: 254
      }
    },
    required: ['username', 'password'],
    additionalProperties: false
  },

  // User login
  loginUser: {
    type: 'object',
    properties: {
      username: { type: 'string', minLength: 1, maxLength: 256 },
      password: { type: 'string', minLength: 1, maxLength: 256 }
    },
    required: ['username', 'password'],
    additionalProperties: false
  },

  // Create auction
  createAuction: {
    type: 'object',
    properties: {
      title: { 
        type: 'string', 
        minLength: 3, 
        maxLength: 200 
      },
      description: { 
        type: 'string', 
        minLength: 10, 
        maxLength: 2000 
      },
      startingBid: { 
        type: 'number', 
        minimum: 0.01,
        maximum: 1000000000,
        multipleOf: 0.01
      },
      endTime: { 
        type: 'string',
        format: 'datetime'
      }
    },
    required: ['title', 'description', 'startingBid', 'endTime'],
    additionalProperties: false
  },

  // Place bid
  placeBid: {
    type: 'object',
    properties: {
      amount: { 
        type: 'number', 
        minimum: 0.01,
        maximum: 1000000000,
        multipleOf: 0.01
      },
      secretKey: { 
        type: 'string', 
        minLength: 8, 
        maxLength: 256 
      }
    },
    required: ['amount', 'secretKey'],
    additionalProperties: false
  },

  // Auction ID parameter
  auctionIdParam: {
    type: 'object',
    properties: {
      id: { 
        type: 'string',
        format: 'uuid'
      }
    },
    required: ['id'],
    additionalProperties: false
  },

  // Query parameters for auctions list
  auctionsQuery: {
    type: 'object',
    properties: {
      page: { 
        type: 'integer', 
        minimum: 1,
        default: 1
      },
      limit: { 
        type: 'integer', 
        minimum: 1, 
        maximum: 100,
        default: 10
      },
      status: { 
        type: 'string', 
        enum: ['active', 'closed', 'cancelled', '']
      }
    },
    additionalProperties: false
  },

  // Email validation
  email: {
    type: 'object',
    properties: {
      email: { 
        type: 'string',
        format: 'email',
        maxLength: 254
      }
    },
    required: ['email'],
    additionalProperties: false
  },

  // Password reset
  resetPassword: {
    type: 'object',
    properties: {
      token: { 
        type: 'string',
        minLength: 32,
        maxLength: 128
      },
      newPassword: { 
        type: 'string', 
        minLength: 8, 
        maxLength: 128 
      }
    },
    required: ['token', 'newPassword'],
    additionalProperties: false
  },

  // Token validation
  token: {
    type: 'object',
    properties: {
      token: { 
        type: 'string',
        minLength: 32,
        maxLength: 128
      }
    },
    required: ['token'],
    additionalProperties: false
  }
};

// Compile validators
const validators = {};
for (const [name, schema] of Object.entries(schemas)) {
  validators[name] = ajv.compile(schema);
}

/**
 * Validate request body against schema
 * @param {string} schemaName - Name of schema to use
 * @param {object} data - Data to validate
 * @returns {{valid: boolean, errors: Array}}
 */
function validate(schemaName, data) {
  const validator = validators[schemaName];
  
  if (!validator) {
    throw new Error(`Unknown schema: ${schemaName}`);
  }

  const valid = validator(data);
  
  if (!valid) {
    const errors = validator.errors.map(err => ({
      field: err.instancePath.slice(1) || 'root',
      message: err.message,
      keyword: err.keyword
    }));
    
    return { valid: false, errors };
  }
  
  return { valid: true, errors: [] };
}

/**
 * Express middleware for schema validation
 * @param {string} schemaName - Name of schema to use
 * @returns {Function} Express middleware
 */
function validateSchema(schemaName) {
  return (req, res, next) => {
    let dataToValidate;
    
    // Determine which data to validate based on schema name
    if (schemaName.includes('Query')) {
      dataToValidate = req.query;
    } else if (schemaName.includes('Param')) {
      dataToValidate = req.params;
    } else {
      dataToValidate = req.body;
    }

    const result = validate(schemaName, dataToValidate);
    
    if (!result.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.errors.map(err => `${err.field}: ${err.message}`)
      });
    }
    
    next();
  };
}

module.exports = {
  validate,
  validateSchema,
  schemas,
  ajv
};
