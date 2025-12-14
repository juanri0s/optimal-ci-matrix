package main

import "testing"

func TestHelper(t *testing.T) {
	if !helper() {
		t.Error("helper failed")
	}
}
