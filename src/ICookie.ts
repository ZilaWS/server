/**
 * @file ZilaWS
 * @module ZilaWS
 * @license
 * MIT License
 * Copyright (c) 2023 ZilaWS
 */
export interface ICookie {
  name: string;
  value: string;
  domain?: string | undefined;
  expires?: Date | undefined;
  httpOnly?: boolean | undefined;
  maxAge?: number | undefined;
  partitioned?: boolean | undefined;
  path?: string | undefined;
  priority?: "low" | "medium" | "high" | undefined;
  sameSite?: true | false | "lax" | "strict" | "none" | undefined;
  secure?: boolean | undefined;
}
