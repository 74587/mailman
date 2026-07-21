package models

import "testing"

func TestNormalizeProxyGatewayUsernameRouteSeparators(t *testing.T) {
	tests := []struct {
		name    string
		input   []string
		want    StringSlice
		wantErr bool
	}{
		{name: "legacy default", want: StringSlice{"#"}},
		{name: "trim and deduplicate", input: []string{" # ", "~", "#", "--"}, want: StringSlice{"#", "~", "--"}},
		{name: "reject letters", input: []string{"route"}, wantErr: true},
		{name: "reject HTTP Basic colon", input: []string{"::"}, wantErr: true},
		{name: "reject query delimiter", input: []string{"?"}, wantErr: true},
		{name: "reject whitespace", input: []string{"# #"}, wantErr: true},
		{name: "reject too long", input: []string{"---------"}, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeProxyGatewayUsernameRouteSeparators(test.input)
			if test.wantErr {
				if err == nil {
					t.Fatalf("expected %v to be rejected", test.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalize separators: %v", err)
			}
			if len(got) != len(test.want) {
				t.Fatalf("separators=%v want=%v", got, test.want)
			}
			for i := range got {
				if got[i] != test.want[i] {
					t.Fatalf("separators=%v want=%v", got, test.want)
				}
			}
		})
	}
}
