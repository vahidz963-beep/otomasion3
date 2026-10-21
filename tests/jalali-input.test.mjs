import assert from 'node:assert/strict';
import {
  formatJalaliDateTyping,
  formatJalaliMonthTyping,
  isCompleteJalaliMonth,
  normalizeJalaliMonth,
} from '../src/lib/jalaliInput.js';

// Date: slash appears at the boundary, but no zero/digit is generated.
assert.equal(formatJalaliDateTyping('1'), '1');
assert.equal(formatJalaliDateTyping('1405'), '1405/');
assert.equal(formatJalaliDateTyping('۱۴۰۵'), '1405/');
assert.equal(formatJalaliDateTyping('1405/0'), '1405/0');
assert.equal(formatJalaliDateTyping('1405/05'), '1405/05/');
assert.equal(formatJalaliDateTyping('1405/05/0'), '1405/05/0');
assert.equal(formatJalaliDateTyping('14050501'), '1405/05/01');
assert.equal(formatJalaliDateTyping('1405-05-01'), '1405/05/01');
assert.equal(formatJalaliDateTyping('1405/5/7'), '1405/5/7');

// Backspace at an automatically generated slash must not trap the caret.
assert.equal(formatJalaliDateTyping('1405', '1405/'), '140');
assert.equal(formatJalaliDateTyping('1405/05', '1405/05/'), '1405/0');

// Year/month fields use the same no-generated-zero behavior and omit the day.
assert.equal(formatJalaliMonthTyping('1405'), '1405/');
assert.equal(formatJalaliMonthTyping('۱۴۰۵۰'), '1405/0');
assert.equal(formatJalaliMonthTyping('140505'), '1405/05');
assert.equal(formatJalaliMonthTyping('1405', '1405/'), '140');
assert.equal(isCompleteJalaliMonth('۱۴۰۵/۵'), true);
assert.equal(isCompleteJalaliMonth('1405/13'), false);
assert.equal(normalizeJalaliMonth('۱۴۰۵/۵'), '1405/05');

console.log('JALALI_INPUT_TEST_OK');
