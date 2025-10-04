export default interface IRequestWrapper {
  headers: { [name: string]: string | string[] | undefined };
  socket: {
    remoteAddress?: string;
    remotePort?: number;
  };
}
