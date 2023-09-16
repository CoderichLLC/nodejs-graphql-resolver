/* Copyright (c) 2023 Coderich LLC. All Rights Reserved. */

module.exports = {
  verbose: true,
  testTimeout: 20000,
  testEnvironment: 'node',
  collectCoverage: false,
  collectCoverageFrom: ['src/**/**/*.js'],
  // globalSetup: '<rootDir>/test/jest.global.setup.js',
  // setupFiles: ['<rootDir>/test/jest.prepare.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/test/**/?(*.)+(spec|test).[jt]s?(x)'],
};
