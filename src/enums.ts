/**
 * @file ZilaWS
 * @module ZilaWS
 * @license
 * MIT License
 * Copyright (c) 2023 ZilaWS
 */
export enum CloseCodes {
  NORMAL = 1000,
  INTERNAL_SERVER_ERROR = 1011,
  SERVER_RESTART = 1012,
  TRY_AGAIN_LATER = 1013,
  TLS_FAIL = 1015,
  KICKED = 4001,
  BANNED = 4002,
  BAD_MESSAGE = 4003,
}

export enum WSStatus {
  OPENING,
  OPEN,
  CLOSED,
  ERROR,
}
