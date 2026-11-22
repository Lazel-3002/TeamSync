package com.teamsync.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Yerel eklentiler super.onCreate'ten ÖNCE kaydedilmeli.
        registerPlugin(TsCallPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
