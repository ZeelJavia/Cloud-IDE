# Test Module Documentation

## Overview

The comprehensive test module provides thorough validation and error detection for the DevDock backend application. This testing infrastructure ensures code quality, functionality, and reliability across all components.

## Test Structure

```
src/tests/
├── testRunner.js           # Master test orchestrator
├── unit/                   # Unit tests for individual components
│   ├── config.test.js      # Configuration validation
│   ├── services.test.js    # Service layer testing
│   └── middleware.test.js  # Middleware functionality
├── integration/            # Integration tests for system components
│   ├── database.test.js    # Database connectivity & models
│   ├── ai.test.js         # AI service integration
│   └── server.test.js     # Server startup & health
└── api/                   # API endpoint testing
    └── endpoints.test.js   # HTTP endpoint validation
```

## Running Tests

### All Tests

```bash
npm test
```

### Specific Test Categories

```bash
# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# API tests only
npm run test:api
```

### Individual Test Files

```bash
# Run specific test file
node src/tests/unit/config.test.js
node src/tests/integration/database.test.js
```

## Test Categories

### 1. Unit Tests

**Purpose**: Test individual components in isolation

#### Configuration Tests (`config.test.js`)

- Environment variable validation
- Configuration defaults verification
- Path generation testing
- Input validation checks

#### Service Tests (`services.test.js`)

- Project service method availability
- File service functionality
- Error handling validation
- Input validation testing

#### Middleware Tests (`middleware.test.js`)

- Authentication middleware structure
- CORS middleware functionality
- Error handler validation
- Middleware chaining verification

### 2. Integration Tests

**Purpose**: Test component interactions and external dependencies

#### Database Tests (`database.test.js`)

- MongoDB connection validation
- Model schema verification
- CRUD operation testing
- Database health monitoring

#### AI Service Tests (`ai.test.js`)

- Google Gemini API connectivity
- Model availability verification
- Code generation testing
- Chat functionality validation

#### Server Tests (`server.test.js`)

- Server startup verification
- Health endpoint testing
- CORS configuration validation
- Error handling integration

### 3. API Tests

**Purpose**: Test HTTP endpoints and API responses

#### Endpoint Tests (`endpoints.test.js`)

- Health endpoint validation
- Authentication endpoint testing
- Project API functionality
- File API operations
- AI API integration
- Error response handling

## Test Features

### Comprehensive Reporting

- Individual test results with pass/fail status
- Execution time tracking
- Success rate calculations
- Detailed error reporting
- Recommendations for improvements

### Error Detection

- Null/undefined value handling
- Invalid input validation
- Network connectivity issues
- Database connection problems
- API integration failures
- Configuration errors

### Flexible Execution

- Run all tests or specific categories
- Individual test file execution
- CLI parameter support
- Detailed console output
- JSON-formatted results

## Test Output Example

```
🚀 STARTING COMPREHENSIVE TEST SUITE
============================================================

🔍 UNIT TESTS - CONFIGURATION
────────────────────────────────────────────────────────────
⚙️ Running Configuration Unit Tests...

🔧 Testing environment variables...
   PORT: 3001
   NODE_ENV: development
   MONGODB_URI: Set
   JWT_SECRET: Set
   API_KEY: Set
✅ Essential environment variables are configured

📋 Testing configuration defaults...
   PORT: 3001 ✅
   NODE_ENV: development ✅
   AI_MODEL: gemini-1.5-flash ✅
✅ 8/8 default values configured

==================================================
⚙️ CONFIGURATION UNIT TEST RESULTS
==================================================
✅ PASS Environment Variables: Essential variables configured
✅ PASS Config Defaults: 8/8 defaults set
✅ PASS Config Validation: 5 values validated
✅ PASS Path Generation: All paths generated correctly
==================================================
📈 Summary: 4 passed, 0 failed
==================================================
```

## Benefits

### 1. **Error Prevention**

- Catches configuration issues early
- Validates all critical dependencies
- Tests error handling paths
- Ensures proper service integration

### 2. **Quality Assurance**

- Comprehensive test coverage
- Automated validation
- Consistent testing standards
- Regression detection

### 3. **Development Confidence**

- Reliable deployment validation
- Quick issue identification
- Continuous integration support
- Documentation of expected behavior

### 4. **Maintenance Support**

- Easy test execution
- Clear failure reporting
- Modular test structure
- Extensible test framework

## Adding New Tests

### Creating a New Test File

```javascript
class NewTest {
  constructor() {
    this.testResults = [];
  }

  async runAllTests() {
    console.log("🔧 Running New Tests...\n");

    await this.testFeature1();
    await this.testFeature2();

    this.printResults();
  }

  async testFeature1() {
    try {
      // Test logic here
      this.addResult("Feature 1", true, "Test passed");
    } catch (error) {
      this.addResult("Feature 1", false, error.message);
    }
  }

  addResult(testName, success, message) {
    this.testResults.push({ testName, success, message });
  }

  printResults() {
    // Standard result formatting
  }
}

module.exports = NewTest;
```

### Integrating with Test Runner

Add the new test to `testRunner.js`:

```javascript
const NewTest = require("./path/to/new.test");

// In runAllTests method:
await this.runTestSuite("New Test Suite", NewTest);
```

## Best Practices

1. **Test Independence**: Each test should be self-contained
2. **Clear Naming**: Use descriptive test and method names
3. **Error Handling**: Always catch and report errors properly
4. **Comprehensive Coverage**: Test both success and failure scenarios
5. **Performance**: Keep tests efficient and fast-running
6. **Documentation**: Comment complex test logic
7. **Cleanup**: Ensure tests don't leave side effects

## Troubleshooting

### Common Issues

1. **MongoDB Connection**: Ensure MongoDB is running and accessible
2. **Environment Variables**: Check that all required env vars are set
3. **API Keys**: Verify Google Gemini API key is valid
4. **Network Access**: Ensure network connectivity for external services
5. **Port Conflicts**: Make sure test ports are available

### Debug Mode

Set `DEBUG=true` environment variable for additional test output and debugging information.

## Dependencies

The test module requires:

- `node-fetch`: For HTTP request testing
- All production dependencies for integration testing
- Node.js built-in modules for file system and path operations

This comprehensive test module ensures the reliability and quality of the DevDock backend application through systematic validation of all components and their interactions.
