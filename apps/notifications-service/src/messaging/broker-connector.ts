import { ChannelModel, connect } from 'amqplib';
import { Injectable } from '@nestjs/common';

export const BROKER_CONNECTOR = Symbol('BROKER_CONNECTOR');

export interface BrokerConnector {
  connect(url: string): Promise<ChannelModel>;
}

@Injectable()
export class RabbitMqConnector implements BrokerConnector {
  connect(url: string): Promise<ChannelModel> {
    return connect(url);
  }
}
