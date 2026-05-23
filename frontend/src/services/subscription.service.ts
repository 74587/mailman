import { logger } from '@/lib/logger';
import { apiClient } from '@/lib/api-client';

export interface EmailFilter {
    from_filter?: string;
    subject_filter?: string;
    has_attachment?: boolean;
    start_date?: string;
    end_date?: string;
}

export interface CreateSubscriptionRequest {
    account_id: number;
    mailbox: string;
    polling_interval: number;
    include_body: boolean;
    from_filter?: string;
    subject_filter?: string;
}

export interface Subscription {
    id: string;
    account_id: number;
    email_address: string;
    mailbox: string;
    polling_interval: number;
    include_body: boolean;
    from_filter?: string;
    subject_filter?: string;
    created_at: string;
    last_fetch?: string;
    next_fetch?: string;
    status: string;
}

export interface SubscriptionsResponse {
    subscriptions: Subscription[];
    total: number;
}

export interface CacheStats {
    total_entries: number;
    total_size: number;
    hit_rate: number;
    miss_rate: number;
    entries: Array<{
        key: string;
        size_bytes: number;
        hit_count: number;
        last_accessed: string;
        expires_at: string;
    }>;
}

export interface FetchNowRequest {
    subscription_id: string;
    force_refresh?: boolean;
}

export interface FetchNowResponse {
    success: boolean;
    emails_fetched: number;
    from_cache: boolean;
    fetch_time_ms: number;
    message?: string;
}

class SubscriptionService {
    private wsConnection: WebSocket | null = null;
    private wsCallbacks: Map<string, (data: any) => void> = new Map();

    // REST API methods
    async createSubscription(data: CreateSubscriptionRequest): Promise<Subscription> {
        const response = await apiClient.post('/subscriptions', data);
        return response;
    }

    async getSubscriptions(): Promise<SubscriptionsResponse> {
        const response = await apiClient.get('/subscriptions');
        return response;
    }

    async deleteSubscription(id: string): Promise<void> {
        await apiClient.delete(`/subscriptions/${id}`);
    }

    async getCacheStats(): Promise<CacheStats> {
        const response = await apiClient.get('/cache/stats');
        return response;
    }

    async fetchNow(data: FetchNowRequest): Promise<FetchNowResponse> {
        const response = await apiClient.post('/emails/fetch-now', data);
        return response;
    }

    // WebSocket methods
    connectWebSocket(onStatusChange?: (connected: boolean) => void, onMessage?: (event: any) => void): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.wsConnection?.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }

            const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:8080/api/ws/subscriptions`;
            this.wsConnection = new WebSocket(wsUrl);

            this.wsConnection.onopen = () => {
                logger.debug('WebSocket connected');
                if (onStatusChange) onStatusChange(true);
                resolve();
            };

            this.wsConnection.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    logger.debug('WebSocket message:', data);

                    // Call registered callbacks
                    if (data.type && this.wsCallbacks.has(data.type)) {
                        this.wsCallbacks.get(data.type)?.(data);
                    }

                    // Call general message handler
                    if (onMessage) {
                        onMessage(data);
                    }
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };

            this.wsConnection.onerror = (error) => {
                console.error('WebSocket error:', error);
                reject(error);
            };

            this.wsConnection.onclose = () => {
                logger.debug('WebSocket disconnected');
                if (onStatusChange) onStatusChange(false);
                this.wsConnection = null;
            };
        });
    }

    disconnectWebSocket() {
        if (this.wsConnection) {
            this.wsConnection.close();
            this.wsConnection = null;
        }
    }

    subscribeToEmails(subscriptionId: string, callback: (data: any) => void) {
        if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket not connected');
        }

        // Register callback for new emails
        this.wsCallbacks.set('new_email', callback);
        this.wsCallbacks.set('fetch_started', callback);
        this.wsCallbacks.set('fetch_completed', callback);
        this.wsCallbacks.set('fetch_error', callback);

        // Send subscribe message
        this.wsConnection.send(JSON.stringify({
            type: 'subscribe',
            subscription_id: subscriptionId
        }));
    }

    unsubscribeFromEmails(subscriptionId: string) {
        if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
            return;
        }

        // Send unsubscribe message
        this.wsConnection.send(JSON.stringify({
            type: 'unsubscribe',
            subscription_id: subscriptionId
        }));

        // Clear callbacks
        this.wsCallbacks.delete('new_email');
        this.wsCallbacks.delete('fetch_started');
        this.wsCallbacks.delete('fetch_completed');
        this.wsCallbacks.delete('fetch_error');
    }

    getActiveSubscriptions(): Promise<string[]> {
        return new Promise((resolve, reject) => {
            if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket not connected'));
                return;
            }

            // Register one-time callback for subscriptions list
            const callback = (data: any) => {
                if (data.type === 'subscriptions') {
                    this.wsCallbacks.delete('subscriptions');
                    resolve(data.data.active_subscriptions || []);
                }
            };
            this.wsCallbacks.set('subscriptions', callback);

            // Send list message
            this.wsConnection.send(JSON.stringify({ type: 'list' }));

            // Timeout after 5 seconds
            setTimeout(() => {
                this.wsCallbacks.delete('subscriptions');
                reject(new Error('Timeout waiting for subscriptions list'));
            }, 5000);
        });
    }
}

export const subscriptionService = new SubscriptionService();
