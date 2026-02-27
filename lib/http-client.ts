import axios, { AxiosInstance } from 'axios';
import clockifyConfig from '../config/clockify.js';

export class HttpClient {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: clockifyConfig.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    this.client.interceptors.request.use((config) => {
      config.headers['X-Api-Key'] = clockifyConfig.apiKey;
      return config;
    });
  }

  getClient() {
    return this.client;
  }
}
