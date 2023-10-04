/**
 * @file ZilaWS
 * @module ZilaWs
 * @license
 * MIT License
 * Copyright (c) 2023 ZilaWS
 */
export interface IWSMessage {
  identifier: string;
  message: any[] | null;
  callbackId: string | null;
}
