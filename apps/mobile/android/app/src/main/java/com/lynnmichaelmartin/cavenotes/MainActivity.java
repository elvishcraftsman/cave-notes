package com.lynnmichaelmartin.cavenotes;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CaveFsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
