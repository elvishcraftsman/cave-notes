import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attrValue } from '../src/engine.js';

// A blank attribute is "there, with nothing in it": empty to expressions whatever its type.
for (const type of ['empty', 'string', 'number', 'bool', 'date']) {
  test(`blank ${type} attribute reaches expressions as null`, () => {
    assert.equal(attrValue([{ type, text: '', num: null }]), null);
  });
}

test('real zero and false are not blank', () => {
  assert.equal(attrValue([{ type: 'number', text: '0', num: 0 }]), 0);
  assert.equal(attrValue([{ type: 'bool', text: 'false', num: 0 }]), false);
});
