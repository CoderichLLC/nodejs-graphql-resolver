/* Copyright (c) 2023 Coderich LLC. All Rights Reserved. */

module.exports = {
  verbose: true,
  testTimeout: 20000,
  testEnvironment: 'node',
  collectCoverage: false,
  collectCoverageFrom: ['src/**/**/*.js'],
  // globalSetup: '<rootDir>/jest.global.setup.js',
  setupFiles: ['<rootDir>/jest.prepare.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/**/?(*.)+(spec|test).[jt]s?(x)'],
};
