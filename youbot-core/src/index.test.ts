import { describe, it, expect, beforeEach, vi } from 'vitest';
import http from 'http';
import { createServer, getAppState, handleRequest, resetState } from './index';

describe('Youbot Core', () => {
  describe('getAppState', () => {
    it('should return the current application state', () => {
      const state = getAppState();
      expect(state.name).toBe('Youbot Core');
      expect(state.version).toBe('1.0.0');
      expect(state.startedAt).toBeInstanceOf(Date);
      expect(typeof state.requestCount).toBe('number');
    });
  });

  describe('createServer', () => {
    it('should create an HTTP server instance', () => {
      const server = createServer();
      expect(server).toBeInstanceOf(http.Server);
    });
  });

  describe('handleRequest', () => {
    let mockRes: {
    writeHead: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
    getHeader: ReturnType<typeof vi.fn>;
      headersSent: boolean;
      writableEnded: boolean;
      destroyed: boolean;
    };

    beforeEach(() => {
      resetState();
    mockRes = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      writeHead: vi.fn(() => {
          mockRes.headersSent = true;
        }),
        end: vi.fn(() => {
          mockRes.writableEnded = true;
        }),
        destroy: vi.fn(() => {
          mockRes.destroyed = true;
        }),
      };
    });

    it('should handle /health endpoint', async () => {
      const req = { url: '/health', method: 'GET' } as http.IncomingMessage;
      await handleRequest(req, mockRes as unknown as http.ServerResponse);
      
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      const responseData = JSON.parse(mockRes.end.mock.calls[0][0]);
      expect(responseData.status).toBe('ok');
      expect(responseData.timestamp).toBeDefined();
    });

    it('should handle /api/state endpoint', async () => {
      const req = { url: '/api/state', method: 'GET' } as http.IncomingMessage;
      await handleRequest(req, mockRes as unknown as http.ServerResponse);
      
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      const responseData = JSON.parse(mockRes.end.mock.calls[0][0]);
      expect(responseData.name).toBe('Youbot Core');
      expect(responseData.version).toBe('1.0.0');
      expect(responseData.uptime).toBeDefined();
    });

    it('should increment request count on each request', async () => {
      const req = { url: '/health', method: 'GET' } as http.IncomingMessage;
      
      await handleRequest(req, mockRes as unknown as http.ServerResponse);
      const state1 = getAppState();
      
      await handleRequest(req, mockRes as unknown as http.ServerResponse);
      const state2 = getAppState();
      
      expect(state2.requestCount).toBeGreaterThan(state1.requestCount);
    });

    it('should return 403 for directory traversal attempts', async () => {
      const req = { url: '/../../../etc/passwd', method: 'GET' } as http.IncomingMessage;
      await handleRequest(req, mockRes as unknown as http.ServerResponse);
      
      expect(mockRes.writeHead).toHaveBeenCalledWith(403, { 'Content-Type': 'text/plain' });
      expect(mockRes.end).toHaveBeenCalledWith('Forbidden');
    });

    it('should not write a second response if the dev proxy errors after headers are sent', async () => {
      const proxyReq = {
        on: vi.fn(),
      };
      let proxyResponseHandler: ((res: any) => void) | undefined;
      const errorHandlers = new Map<string, (error: Error) => void>();

      vi.spyOn(http, 'request').mockImplementation(((options, callback) => {
        proxyResponseHandler = callback as (res: any) => void;
        return proxyReq as unknown as http.ClientRequest;
      }) as typeof http.request);

      proxyReq.on.mockImplementation((event: string, handler: (error: Error) => void) => {
        errorHandlers.set(event, handler);
        return proxyReq;
      });

      const req = {
        url: '/dashboard',
        method: 'GET',
        headers: {},
        pipe: vi.fn(() => {
          proxyResponseHandler?.({
            statusCode: 200,
            headers: {},
            pipe: vi.fn(),
          });
          errorHandlers.get('error')?.(new Error('proxy failed'));
          return proxyReq;
        }),
      } as unknown as http.IncomingMessage;

      await handleRequest(req, mockRes as unknown as http.ServerResponse);

      expect(mockRes.writeHead).toHaveBeenCalledTimes(1);
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, {});
      expect(mockRes.destroy).toHaveBeenCalledTimes(1);
      expect(mockRes.end).not.toHaveBeenCalledWith(
        expect.stringContaining('Frontend dev server not ready')
      );
    });
  });
});
