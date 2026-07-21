package models

import "testing"

func TestNormalizeProxyGatewayTargetMatcher(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "domain", input: " API.Example.COM. ", want: "api.example.com"},
		{name: "wildcard", input: "*.Example.com", want: "*.example.com"},
		{name: "international domain", input: "例子.测试", want: "xn--fsqu00a.xn--0zwm56d"},
		{name: "ipv4", input: "203.0.113.7", want: "203.0.113.7"},
		{name: "ipv6", input: "[2001:db8::7]", want: "2001:db8::7"},
		{name: "cidr", input: "203.0.113.8/24", want: "203.0.113.0/24"},
		{name: "catch all", input: "*", wantErr: true},
		{name: "mid wildcard", input: "api.*.example.com", wantErr: true},
		{name: "url", input: "https://example.com", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeProxyGatewayTargetMatcher(test.input)
			if test.wantErr {
				if err == nil {
					t.Fatalf("expected error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalize: %v", err)
			}
			if got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
		})
	}
}

func TestProxyGatewayTargetMatches(t *testing.T) {
	tests := []struct {
		name    string
		target  string
		matcher string
		want    bool
	}{
		{name: "exact domain", target: "API.Example.com.", matcher: "api.example.com", want: true},
		{name: "wildcard subdomain", target: "v1.api.example.com", matcher: "*.example.com", want: true},
		{name: "wildcard excludes apex", target: "example.com", matcher: "*.example.com", want: false},
		{name: "wildcard boundary", target: "notexample.com", matcher: "*.example.com", want: false},
		{name: "ipv4 exact", target: "203.0.113.7", matcher: "203.0.113.7", want: true},
		{name: "ipv4 cidr", target: "203.0.113.7", matcher: "203.0.113.0/24", want: true},
		{name: "ipv4 outside cidr", target: "198.51.100.7", matcher: "203.0.113.0/24", want: false},
		{name: "ipv6 cidr", target: "2001:db8::7", matcher: "2001:db8::/32", want: true},
		{name: "ip never matches domain", target: "203.0.113.7", matcher: "example.com", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := ProxyGatewayTargetMatches(test.target, test.matcher); got != test.want {
				t.Fatalf("match(%q, %q) = %v, want %v", test.target, test.matcher, got, test.want)
			}
		})
	}
}
