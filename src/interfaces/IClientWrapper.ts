export default interface IClientWrapper {
  /**
   * Send data to the client.
   */
  send(data: any): void;
  /**
   * Close the client connection.
   */
  close(code?: number, reason?: string): void;
  /**
   * Optional event attachment (Node/EventTarget style)
   */
  addEventListener(event: string, listener: (...args: any[]) => void): void;
  addListener(event: string, listener: (...args: any[]) => void): void;
  on?(event: string, listener: (...args: any[]) => void): void;
  /**
   * Triggers an event
   * @param event
   * @param args
   */
  emit(event: string | symbol, ...args: any[]): void;
  readonly readyState?: number;
}
