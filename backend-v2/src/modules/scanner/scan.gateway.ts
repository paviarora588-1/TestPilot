import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

export interface ScanProgressEvent {
  sessionId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  message: string;
}

@WebSocketGateway({ cors: { origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000' }, namespace: '/scan' })
export class ScanGateway {
  @WebSocketServer()
  server!: Server;

  @SubscribeMessage('join')
  handleJoin(@MessageBody() sessionId: string, @ConnectedSocket() client: Socket) {
    client.join(sessionId);
  }

  emitProgress(event: ScanProgressEvent) {
    this.server.to(event.sessionId).emit('progress', event);
  }
}
