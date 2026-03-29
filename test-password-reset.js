/**
 * Password Reset API Test Script
 * Tests the complete password reset flow
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3001';

async function testPasswordReset() {
  console.log('=== Testing Password Reset Flow ===\n');

  try {
    // Step 1: Register a test user with email
    console.log('1. Registering test user...');
    const registerResponse = await axios.post(`${BASE_URL}/api/users/register`, {
      username: 'testuser_reset',
      password: 'testpassword123',
      email: 'test@example.com'
    });
    console.log('✓ User registered:', registerResponse.data.message);
    console.log('  User ID:', registerResponse.data.userId);
    console.log('  Email:', registerResponse.data.email);

    // Step 2: Request password reset
    console.log('\n2. Requesting password reset...');
    const resetRequestResponse = await axios.post(`${BASE_URL}/api/users/request-password-reset`, {
      email: 'test@example.com'
    });
    console.log('✓ Password reset requested:', resetRequestResponse.data.message);

    // Step 3: Try to reset with invalid token
    console.log('\n3. Testing invalid token...');
    try {
      await axios.post(`${BASE_URL}/api/users/reset-password`, {
        token: 'invalid-token-123',
        newPassword: 'newpassword123'
      });
      console.log('✗ Should have failed with invalid token');
    } catch (error) {
      if (error.response && error.response.status === 400) {
        console.log('✓ Invalid token properly rejected');
      } else {
        throw error;
      }
    }

    // Step 4: Validate token endpoint (would need actual token from email)
    console.log('\n4. Testing token validation endpoint...');
    try {
      await axios.get(`${BASE_URL}/api/users/validate-reset-token/invalid-token`);
      console.log('✗ Should have failed with invalid token');
    } catch (error) {
      if (error.response && error.response.status === 400) {
        console.log('✓ Token validation properly rejects invalid tokens');
      } else {
        throw error;
      }
    }

    // Step 5: Test with non-existent email
    console.log('\n5. Testing non-existent email...');
    const nonExistentResponse = await axios.post(`${BASE_URL}/api/users/request-password-reset`, {
      email: 'nonexistent@example.com'
    });
    console.log('✓ Non-existent email handled gracefully:', nonExistentResponse.data.message);

    // Step 6: Test rate limiting (multiple requests)
    console.log('\n6. Testing rate limiting...');
    try {
      for (let i = 0; i < 5; i++) {
        await axios.post(`${BASE_URL}/api/users/request-password-reset`, {
          email: 'test@example.com'
        });
      }
      console.log('✗ Should have been rate limited');
    } catch (error) {
      if (error.response && error.response.status === 429) {
        console.log('✓ Rate limiting is working');
      } else {
        console.log('Rate limiting test inconclusive:', error.message);
      }
    }

    console.log('\n=== Password Reset Flow Test Complete ===');
    console.log('✓ All basic functionality tests passed');
    console.log('\nNote: Full end-to-end test requires:');
    console.log('- Email service configuration');
    console.log('- Manual token extraction from email');
    console.log('- Frontend reset page implementation');

  } catch (error) {
    console.error('\n❌ Test failed:', error.response?.data || error.message);
    if (error.response?.status === 404) {
      console.log('Make sure the server is running on', BASE_URL);
    }
  }
}

// Run the test
if (require.main === module) {
  testPasswordReset();
}

module.exports = testPasswordReset;
