const js = require('@eslint/js');
const ts = require('typescript-eslint');
const prettier = require('eslint-plugin-prettier/recommended');
const jsdoc = require('eslint-plugin-jsdoc');
const globals = require('globals');

const customJsRules = {
    'sort-imports': 'error',
};
const customTsRules = {
    '@typescript-eslint/consistent-type-imports': [
        'error',
        {
            prefer: 'type-imports',
            fixStyle: 'separate-type-imports',
        },
    ],
};

// Only apply ts configs to TypeScript files.
const tsConfigs = ts.configs.recommended.map((config) =>
    !config.files ? { ...config, files: ['**/*.ts'] } : config,
);

/**
 * Exports the ESLint configuration.
 */
module.exports = [
    {
        ignores: ['**/dist/**', '**/node_modules/**'],
    },
    // Globals
    {
        languageOptions: {
            ecmaVersion: 2021,
            globals: {
                ...globals.commonjs,
            },
        },
    },
    // Add node globals to files not in src folders, these are always ran in Node context.
    // Mainly needed for processing config files.
    {
        files: ['**/*', '!**/src/**'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
    js.configs.recommended,
    ...tsConfigs,
    jsdoc.configs['flat/recommended'],
    jsdoc.configs['flat/recommended-typescript'],
    // Prettier comes after Vue to ensure it doesn't conflict with Vue's formatting rules.
    prettier,
    // Custom JS config.
    {
        files: ['**/*.js'],
        rules: {
            ...customJsRules,
        },
    },
    // Custom TS config.
    {
        files: ['**/*.ts'],
        plugins: {
            '@typescript-eslint': ts.plugin,
        },
        languageOptions: {
            parser: ts.parser,
            parserOptions: {
                project: true,
            },
        },
        rules: {
            ...customJsRules,
            ...customTsRules,
        },
    },
];
