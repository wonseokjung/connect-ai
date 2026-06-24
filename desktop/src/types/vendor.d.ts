declare module 'axios' {
  const axios: any;
  export default axios;
}

declare module 'electron-updater' {
  export const autoUpdater: any;
}

declare module 'imapflow' {
  export class ImapFlow {
    constructor(options: any);
    connect(): Promise<void>;
    getMailboxLock(mailbox: string): Promise<{ release(): void }>;
    search(query: any, options?: any): Promise<any[]>;
    fetchOne(sequence: string, query: any, options?: any): Promise<any>;
    logout(): Promise<void>;
    close(): Promise<void>;
  }
}

declare module 'mailparser' {
  export function simpleParser(source: any): Promise<any>;
}

declare module 'msedge-tts' {
  export const OUTPUT_FORMAT: any;
  export class MsEdgeTTS {
    setMetadata(voice: string, outputFormat: any): Promise<void>;
    toStream(text: string, options?: any): { audioStream: any };
  }
}

declare module '@modelcontextprotocol/sdk/client/index.js' {
  export class Client {
    constructor(clientInfo: any, options?: any);
    connect(transport: any): Promise<void>;
    listTools(): Promise<{ tools?: any[] }>;
    callTool(args: any): Promise<any>;
  }
}

declare module '@modelcontextprotocol/sdk/client/streamableHttp.js' {
  export class StreamableHTTPClientTransport {
    constructor(url: URL, options?: any);
  }
}

declare module '@modelcontextprotocol/sdk/client/sse.js' {
  export class SSEClientTransport {
    constructor(url: URL, options?: any);
  }
}

declare module '@modelcontextprotocol/sdk/client/stdio.js' {
  export class StdioClientTransport {
    constructor(options: any);
  }
}
