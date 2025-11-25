export type TwilioRequestOptions = {
	method: "get" | "post";
	uri: string;
	params?: Record<string, string | number>;
	form?: Record<string, string>;
	body?: unknown;
	contentType?: string;
};

export type TwilioSender = { sid: string; sender_id: string };

export type TwilioRequestResponse = {
	data?: {
		senders?: TwilioSender[];
	};
};

export type IncomingNumber = {
	sid: string;
	phoneNumber: string;
	smsUrl?: string;
};

export type TwilioChannelsSender = {
	sid?: string;
	senderId?: string;
	sender_id?: string;
	webhook?: {
		callback_url?: string;
		callback_method?: string;
		fallback_url?: string;
		fallback_method?: string;
	};
};

export type ChannelSenderUpdater = {
	update: (params: Record<string, string>) => Promise<unknown>;
};

export type IncomingPhoneNumberUpdater = {
	update: (params: Record<string, string>) => Promise<unknown>;
};

export type IncomingPhoneNumbersClient = {
	list: (params: {
		phoneNumber: string;
		limit?: number;
	}) => Promise<IncomingNumber[]>;
	get: (sid: string) => IncomingPhoneNumberUpdater;
} & ((sid: string) => IncomingPhoneNumberUpdater);

export type TwilioSenderListClient = {
	messaging: {
		v2: {
			channelsSenders: {
				list: (params: {
					channel: string;
					pageSize: number;
				}) => Promise<TwilioChannelsSender[]>;
				(
					sid: string,
				): ChannelSenderUpdater & {
					fetch: () => Promise<TwilioChannelsSender>;
				};
			};
		};
		v1: {
			services: (sid: string) => {
				update: (params: Record<string, string>) => Promise<unknown>;
				fetch: () => Promise<{ inboundRequestUrl?: string }>;
			};
		};
	};
	incomingPhoneNumbers: IncomingPhoneNumbersClient;
};

export type TwilioRequester = {
	request: (options: TwilioRequestOptions) => Promise<TwilioRequestResponse>;
};
