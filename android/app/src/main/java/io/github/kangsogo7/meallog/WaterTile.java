package io.github.kangsogo7.meallog;

import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * 빠른 설정 버튼 "물 한 잔": 화면 위를 내리면 나오는 버튼. 잠금화면에서도 내려서 누를 수 있음.
 * 누르면 앱을 열지 않고 한 잔 더하고(물 위젯과 같은 방식), 앱이 열릴 때 기록에 반영됨.
 * 버튼 아래 작은 글씨에 오늘 마신 잔 수
 */
public class WaterTile extends TileService {
    @Override
    public void onStartListening() {
        show();
    }

    @Override
    public void onClick() {
        WidgetStore.addWater(this);
        show();
    }

    private void show() {
        Tile t = getQsTile();
        if (t == null) return;
        int[] w = WidgetStore.waterCups(this);
        t.setLabel(getString(R.string.tile_water));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) t.setSubtitle(w[0] + " / " + w[1] + "잔");
        t.setState(w[0] > 0 ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        t.updateTile();
    }
}
