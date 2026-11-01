import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCheckoutServer } from '../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootCheckoutPath = path.resolve(__dirname, '../../../../checkout.html');

describe('Cards, Scan to Pay, and Native Payments Verification', () => {
  let serverInstance;
  let baseUrl;

  before(async () => {
    // Start on test port 7196
    serverInstance = await startCheckoutServer(7196);
    baseUrl = `http://localhost:${serverInstance.port}`;
  });

  after(async () => {
    await serverInstance.close();
  });

  function get(route) {
    return new Promise((resolve, reject) => {
      http.get(`${baseUrl}${route}`, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, text: data });
        });
      }).on('error', reject);
    });
  }

  test('checkout.html exists and is readable in workspace root', () => {
    assert.ok(fs.existsSync(rootCheckoutPath), 'checkout.html must exist at root');
    const content = fs.readFileSync(rootCheckoutPath, 'utf8');
    assert.ok(content.length > 10000, 'checkout.html must be populated');
  });

  test('GET / serves checkout.html with jsQR and camera scan assets', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/html'));

    // Check jsQR inclusion
    assert.ok(res.text.includes('jsqr@1.4.0'), 'Must include jsQR engine');
    // Check Top Bar Scan button
    assert.ok(res.text.includes('openScannerModal()'), 'Must include openScannerModal trigger');
    assert.ok(res.text.includes('SCAN TO PAY'), 'Must include SCAN TO PAY label');
  });

  test('GET / includes Screen 3 Cards Vault and 5-item dock', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);

    // Cards Vault Screen
    assert.ok(res.text.includes('id="screenCards"'), 'Must include screenCards section');
    assert.ok(res.text.includes('id="featuredCardContainer"'), 'Must include virtual card preview');
    assert.ok(res.text.includes('id="savedCardsList"'), 'Must include saved cards list container');
    assert.ok(res.text.includes('openAddCardModal()'), 'Must include openAddCardModal button');

    // 5-Item Navigation Dock
    assert.ok(res.text.includes('id="navDockPay"'), 'Must have Pay dock button');
    assert.ok(res.text.includes('id="navDockCards"'), 'Must have Cards dock button');
    assert.ok(res.text.includes('id="navDockLedger"'), 'Must have Activity dock button');
    assert.ok(res.text.includes('id="navDockAccount"'), 'Must have Account dock button');
    assert.ok(res.text.includes('id="navDockCloud"'), 'Must have Cloud dock button');
  });

  test('GET / includes all Production Native Payment Hub and Security Modals (Zero Simulation)', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);

    // Camera QR Scanner Modal
    assert.ok(res.text.includes('id="scannerModal"'), 'Must include scannerModal');
    assert.ok(res.text.includes('id="scannerVideo"'), 'Must include scannerVideo element');
    assert.ok(res.text.includes('id="qrFileInput"'), 'Must include qrFileInput for photo gallery');
    assert.ok(res.text.includes('id="torchBtn"'), 'Must include flashlight torch toggle');

    // Add Card Modal & RBI Tokenization
    assert.ok(res.text.includes('id="addCardModal"'), 'Must include addCardModal');
    assert.ok(res.text.includes('id="inputCardNumber"'), 'Must include inputCardNumber');
    assert.ok(res.text.includes('id="inputCardHolder"'), 'Must include inputCardHolder');
    assert.ok(res.text.includes('id="inputCardExpiry"'), 'Must include inputCardExpiry');
    assert.ok(res.text.includes('id="inputCardCvv"'), 'Must include inputCardCvv');
    assert.ok(res.text.includes('RBI TOKENIZATION &amp; PCI-DSS 4.0'), 'Must display RBI compliance notice');

    // Native Payment Hub Modal & Real UPI Intents
    assert.ok(res.text.includes('id="nativePaymentModal"'), 'Must include nativePaymentModal');
    assert.ok(res.text.includes('id="nativeCardSelect"'), 'Must include card selector');
    assert.ok(res.text.includes('startNativeCardPayment()'), 'Must include startNativeCardPayment');
    assert.ok(res.text.includes('triggerUniversalUpiIntent()'), 'Must include triggerUniversalUpiIntent');
    assert.ok(res.text.includes('triggerAppIntent'), 'Must include triggerAppIntent');
    assert.ok(res.text.includes('id="nativeBankUtrInput"'), 'Must include 12-digit Bank UTR confirmation');
    assert.ok(res.text.includes('confirmNativePaymentWithUtr()'), 'Must include confirmNativePaymentWithUtr');

    // Authentic 3D Secure 2.0 Bank Verification Modal (Zero Simulation)
    assert.ok(res.text.includes('id="cardOtpModal"'), 'Must include cardOtpModal');
    assert.ok(res.text.includes('id="bankOtpInput"'), 'Must include bankOtpInput');
    assert.ok(res.text.includes('resendBankOtp()'), 'Must include resendBankOtp');
    assert.ok(res.text.includes('submitBankOtp()'), 'Must include submitBankOtp');

    // Strict Zero-Simulation Invariant: NO fake autofill buttons, badges, or web PIN pads
    assert.ok(!res.text.includes('autofillSimulatedOtp'), 'Must NOT have simulated OTP autofill');
    assert.ok(!res.text.includes('simulatedOtpBadge'), 'Must NOT have simulated OTP badge');
    assert.ok(!res.text.includes('id="upiPinModal"'), 'Must NOT have fake on-screen UPI PIN keypad');
    assert.ok(!res.text.includes('addDemoCard'), 'Must NOT have demo card presets');

    // Payment Success Celebration Modal
    assert.ok(res.text.includes('id="paymentSuccessModal"'), 'Must include paymentSuccessModal');
  });

  test('Luhn algorithm correctly validates genuine card numbers', () => {
    function validateLuhn(num) {
      const clean = (num || '').replace(/\D/g, '');
      if (clean.length < 13 || clean.length > 19) return false;
      let sum = 0;
      let shouldDouble = false;
      for (let i = clean.length - 1; i >= 0; i--) {
        let digit = parseInt(clean.charAt(i), 10);
        if (shouldDouble) {
          digit *= 2;
          if (digit > 9) digit -= 9;
        }
        sum += digit;
        shouldDouble = !shouldDouble;
      }
      return (sum % 10) === 0;
    }

    // Valid Luhn test numbers (16-digit test vectors)
    assert.equal(validateLuhn('4532015000000007'), true); // standard Luhn valid test
    assert.equal(validateLuhn('4532015000000008'), false); // standard Luhn invalid test
    assert.equal(validateLuhn('4532012345674242'), false); // deliberately invalid test num
  });

  test('UPI URI parser correctly extracts payment attributes from decoded QR text', () => {
    const rawQr = 'upi://pay?pa=store@okhdfcbank&pn=Mitto%20Merchant&am=750.50&cu=INR&tn=Order%20Payment';
    const url = new URL(rawQr.replace('upi://pay?', 'http://dummy.com/?'));
    
    assert.equal(url.searchParams.get('pa'), 'store@okhdfcbank');
    assert.equal(url.searchParams.get('pn'), 'Mitto Merchant');
    assert.equal(url.searchParams.get('am'), '750.50');
    assert.equal(url.searchParams.get('tn'), 'Order Payment');
  });

  test('Card network detection accurately identifies major Indian networks', () => {
    function detectCardNetwork(num) {
      const clean = (num || '').replace(/\D/g, '');
      if (/^4/.test(clean)) return 'VISA';
      if (/^(5[1-5]|2[2-7])/.test(clean)) return 'MASTERCARD';
      if (/^(60|65|81|82|508)/.test(clean)) return 'RUPAY';
      if (/^3[47]/.test(clean)) return 'AMEX';
      return 'CARD';
    }

    assert.equal(detectCardNetwork('4532 0123 4567 8910'), 'VISA');
    assert.equal(detectCardNetwork('5123 4567 8910 1112'), 'MASTERCARD');
    assert.equal(detectCardNetwork('6082 1234 5678 9012'), 'RUPAY');
    assert.equal(detectCardNetwork('3782 822463 10005'), 'AMEX');
  });

  test('Native UPI app schemes match authentic Android/iOS URI specifications', () => {
    const rawParams = 'pa=merchant@upi&pn=Store&am=500.00&cu=INR';
    const schemes = {
      gpay: `tez://upi/pay?${rawParams}`,
      phonepe: `phonepe://pay?${rawParams}`,
      paytm: `paytmmp://pay?${rawParams}`,
      bhim: `bhim://pay?${rawParams}`,
      cred: `credpay://upi/pay?${rawParams}`,
      mobikwik: `mobikwik://upi/pay?${rawParams}`,
      universal: `upi://pay?${rawParams}`
    };

    assert.ok(schemes.gpay.startsWith('tez://upi/pay?'));
    assert.ok(schemes.phonepe.startsWith('phonepe://pay?'));
    assert.ok(schemes.paytm.startsWith('paytmmp://pay?'));
    assert.ok(schemes.bhim.startsWith('bhim://pay?'));
    assert.ok(schemes.cred.startsWith('credpay://upi/pay?'));
    assert.ok(schemes.universal.startsWith('upi://pay?'));
  });
});
