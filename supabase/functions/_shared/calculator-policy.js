const ACTION_POLICY = Object.freeze({
  preview_transformer_fill: Object.freeze({ scope: 'internal', persist: false, response: 'fill' }),
  preview_transformer: Object.freeze({ scope: 'internal', persist: false, response: 'full' }),
  confirm_transformer: Object.freeze({ scope: 'internal', persist: true, response: 'full' }),
  // Compatibility contract for clients deployed before the preview/confirm split.
  calculate_transformer: Object.freeze({ scope: 'internal', persist: true, response: 'full', legacy: true }),
  public_quote_preview: Object.freeze({ scope: 'public', persist: false, response: 'full' }),
  public_quote_confirm: Object.freeze({ scope: 'public', persist: true, response: 'full' }),
  // Compatibility contract for connector v1.0.0.
  public_quote: Object.freeze({ scope: 'public', persist: true, response: 'full', legacy: true }),
});

export function transformerActionPolicy(action) {
  return ACTION_POLICY[action] || null;
}

export function shouldPersistTransformerAction(action) {
  return transformerActionPolicy(action)?.persist === true;
}
