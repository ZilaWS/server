import IRequestWrapper from "../interfaces/IRequestWrapper";

export default class IncomingMessageWrapper implements IRequestWrapper {
  constructor(
    public readonly headers: { [name: string]: string | string[] | undefined },
    public readonly socket: { remoteAddress?: string; remotePort?: number }
  ) {}
}
