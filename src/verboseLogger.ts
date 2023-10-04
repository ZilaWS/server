/**
 * @file ZilaWS
 * @module ZilaWs
 * @license
 * MIT License
 * Copyright (c) 2023 ZilaWS
 */
export interface ILogger {
  log: Function;
  warn: Function;
  error: Function;
}

const verbosePrefix = "[ZilaWS] (Verbose): ";
const prefix = "[ZilaWS]: ";

export const VerboseLogger: ILogger = {
  log(text: string) {
    console.log(verbosePrefix + text);
  },
  warn(text: string) {
    console.warn(verbosePrefix + text);
  },
  error(text: string) {
    console.error(verbosePrefix + text);
  },
};

export const SimpleLogger: ILogger = {
  log(text: string) {
    console.log(prefix + text);
  },
  warn(text: string) {
    console.warn(prefix + text);
  },
  error(text: string) {
    console.error(prefix + text);
  },
};
