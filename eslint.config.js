import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', 'legacy/', 'node_modules/', 'dev-dist/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      // The app's central XSS invariant: remote/feed data reaches the DOM only
      // through h() / textContent, never through innerHTML. Static template
      // constants are fine, so only interpolation is banned — that is the shape
      // an accident would take. Until now the rule lived in CONTRIBUTING.md
      // prose, with nothing to catch a regression.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/] > TemplateLiteral[expressions.length>0]',
          message:
            'Do not interpolate into innerHTML — build nodes with h() from src/ui/h.ts instead.',
        },
        {
          selector:
            'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/] > BinaryExpression[operator="+"]',
          message:
            'Do not concatenate into innerHTML — build nodes with h() from src/ui/h.ts instead.',
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: 'insertAdjacentHTML is an XSS sink — build nodes with h() instead.',
        },
        {
          selector: "NewExpression[callee.name='Function'], CallExpression[callee.name='eval']",
          message: 'Dynamic code evaluation is not allowed (and is blocked by the CSP).',
        },
      ],
    },
  },
);
