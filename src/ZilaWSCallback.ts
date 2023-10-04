/**
 * @file ZilaWS
 * @module ZilaWs
 * @license
 * MIT License
 * Copyright (c) 2023 ZilaWS
 */
import IZilaClient from "./ZilaClient";

export type ZilaWSCallback = (socket: IZilaClient, ...args: any[]) => any;
