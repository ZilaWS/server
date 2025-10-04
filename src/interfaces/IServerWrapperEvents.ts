import IClientWrapper from "./IClientWrapper";
import IRequestWrapper from "./IRequestWrapper";
import ServerWrapper from "../wrappers/ServerWrapper";

export default interface IServerWrapperEvents {
  connection: (this: ServerWrapper, socket: IClientWrapper, request: IRequestWrapper) => void;
  close: () => void;
  error: (err: Error) => void;
  headers: (this: ServerWrapper, headers: string[], request: IRequestWrapper) => void;
  /**
   * Internal event emitted by wrappers when /zilaws/cookieSync is requested.
   * The second argument is a responder callback allowing the listener to provide Set-Cookie headers.
   */
  cookieSync?: (
    this: ServerWrapper,
    payload: { type: "cookieSync"; ip?: string; cookies?: string },
    respond: (setCookieHeaders?: string[]) => void
  ) => void;
}
